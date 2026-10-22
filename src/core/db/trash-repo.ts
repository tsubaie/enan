import 'server-only';
import { sql } from 'drizzle-orm';
import type { Database } from './client';
// ADMIN-B48 TASKS-B11: an item in the trash longer than `retention.trash_days` is deleted for good,
// with its own parts, and only while nothing else links to it. The schema says which is which,
// so a new module's tables need nothing here: a link that deletes with its item (ON DELETE CASCADE)
// is one of that item's parts (a note's participants, a KPI's readings); any other link is a
// reference, and a referenced item stays, live referrer or trashed, so purging never changes
// another row. Accounts are not trash: deactivated users keep their history.
const notTrash = new Set(['users']);
type Reference = { table: string; column: string; target: string };
async function schema(database: Database) {
  const tables = await database.all<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%'`,
  );
  const trash: string[] = [];
  const references = new Map<string, Reference[]>();
  for (const { name } of tables) {
    const columns = await database.all<{ name: string }>(
      sql`select name from pragma_table_info(${name})`,
    );
    if (columns.some((column) => column.name === 'deleted_at') && !notTrash.has(name))
      trash.push(name);
    const links = await database.all<{ table: string; from: string; to: string; on_delete: string }>(
      sql`select "table", "from", "to", on_delete from pragma_foreign_key_list(${name})`,
    );
    for (const link of links)
      if (link.on_delete !== 'CASCADE')
        references.set(link.table, [
          ...(references.get(link.table) ?? []),
          { table: name, column: link.from, target: link.to },
        ]);
  }
  return { trash, references };
}
// Repeated until a pass deletes nothing: a trashed subtask goes before its trashed parent, a
// trashed note before the trashed person it lists. Returns how many rows went, by table.
export async function purgeTrash(database: Database, before: Date) {
  const { trash, references } = await schema(database);
  const removed: Record<string, number> = {};
  for (let pass = 0; pass < 10; pass += 1) {
    let changed = 0;
    for (const table of trash) {
      const blocked = (references.get(table) ?? []).map(
        (link) =>
          sql`exists (select 1 from ${sql.identifier(link.table)} r where r.${sql.identifier(link.column)} = ${sql.identifier(table)}.${sql.identifier(link.target)})`,
      );
      const result = await database.run(
        sql`delete from ${sql.identifier(table)} where deleted_at < ${before.getTime()}${
          blocked.length ? sql` and not (${sql.join(blocked, sql` or `)})` : sql``
        }`,
      );
      if (result.rowsAffected) removed[table] = (removed[table] ?? 0) + result.rowsAffected;
      changed += result.rowsAffected;
    }
    if (!changed) break;
  }
  return removed;
}
