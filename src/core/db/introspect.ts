import 'server-only';
import { is, sql } from 'drizzle-orm';
import { SQLiteTable, getTableConfig } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import type { Database } from './client';
// Catalog reflection for audit:schema over `sqlite_master` and the pragma table-valued functions.
// Read-only; no business meaning. Constraint types follow the PostgreSQL letters the audit already
// understands: 'p' primary key, 'u' unique, 'f' foreign key, 'c' check.
export type TableShape = {
  name: string;
  columns: { name: string; notNull: boolean }[];
  indexes: string[];
  checks: string[];
  foreignKeyColumns: string[][];
};
export type DbTable = {
  name: string;
  columns: { name: string; nullable: boolean; generated: boolean }[];
  indexes: { name: string; definition: string }[];
  constraints: { name: string; type: string; definition: string }[];
  triggers: string[];
};
export function shapeOf(candidate: object): TableShape | null {
  if (!is(candidate, SQLiteTable)) return null;
  const config = getTableConfig(candidate);
  return {
    name: config.name,
    columns: config.columns.map((column) => ({ name: column.name, notNull: column.notNull })),
    indexes: config.indexes.map((index) => index.config.name ?? ''),
    checks: config.checks.map((check) => check.name),
    foreignKeyColumns: config.foreignKeys.map((key) =>
      key.reference().columns.map((column) => column.name),
    ),
  };
}
const Names = z.array(z.object({ name: z.string() }));
async function names(database: Database, query: ReturnType<typeof sql>) {
  return Names.parse(await database.all(query)).map((row) => row.name);
}
export function listTables(database: Database) {
  return names(
    database,
    sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name <> '__drizzle_migrations' order by 1`,
  );
}
const Column = z.object({
  name: z.string(),
  notnull: z.number(),
  pk: z.number(),
  hidden: z.number(),
});
const Index = z.object({ name: z.string(), unique: z.number(), origin: z.string() });
const IndexSql = z.object({ name: z.string(), sql: z.string().nullable() });
const ForeignKey = z.object({
  id: z.number(),
  table: z.string(),
  from: z.string(),
  to: z.string(),
});
const Definition = z.object({ sql: z.string() });
// CHECK constraints are only visible in the table's own DDL.
export function parseChecks(ddl: string) {
  const checks: { name: string; definition: string }[] = [];
  const pattern = /constraint\s+"?([\w]+)"?\s+check\s*\(/giu;
  for (const match of ddl.matchAll(pattern)) {
    let depth = 1;
    let end = match.index + match[0].length;
    while (end < ddl.length && depth > 0) {
      const char = ddl[end];
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      end += 1;
    }
    checks.push({
      name: match[1] ?? '',
      definition: `CHECK (${ddl.slice(match.index + match[0].length, end - 1)})`,
    });
  }
  return checks;
}
function constraintsOf(
  ddl: string,
  columns: z.infer<typeof Column>[],
  indexes: z.infer<typeof Index>[],
  foreignKeys: z.infer<typeof ForeignKey>[],
) {
  const constraints: DbTable['constraints'] = [];
  const primary = columns.filter((column) => column.pk > 0).map((column) => column.name);
  if (primary.length)
    constraints.push({
      name: 'primary',
      type: 'p',
      definition: `PRIMARY KEY (${primary.join(', ')})`,
    });
  for (const index of indexes)
    if (index.origin === 'u')
      constraints.push({ name: index.name, type: 'u', definition: `UNIQUE (${index.name})` });
  for (const key of foreignKeys)
    constraints.push({
      name: `fk_${key.id}_${key.from}`,
      type: 'f',
      definition: `FOREIGN KEY (${key.from}) REFERENCES ${key.table}(${key.to})`,
    });
  for (const check of parseChecks(ddl)) constraints.push({ ...check, type: 'c' });
  return constraints;
}
export async function describeTable(database: Database, table: string): Promise<DbTable> {
  const [definition] = z
    .array(Definition)
    .parse(
      await database.all(
        sql`select sql from sqlite_master where type = 'table' and name = ${table}`,
      ),
    );
  const columns = z
    .array(Column)
    .parse(
      await database.all(sql`select name, "notnull", pk, hidden from pragma_table_xinfo(${table})`),
    );
  const indexList = z
    .array(Index)
    .parse(await database.all(sql`select name, "unique", origin from pragma_index_list(${table})`));
  const indexSql = z
    .array(IndexSql)
    .parse(
      await database.all(
        sql`select name, sql from sqlite_master where type = 'index' and tbl_name = ${table} order by 1`,
      ),
    );
  const foreignKeys = z
    .array(ForeignKey)
    .parse(
      await database.all(
        sql`select id, "table", "from", "to" from pragma_foreign_key_list(${table})`,
      ),
    );
  const triggers = await names(
    database,
    sql`select name from sqlite_master where type = 'trigger' and tbl_name = ${table} order by 1`,
  );
  return {
    name: table,
    columns: columns.map((column) => ({
      name: column.name,
      nullable: column.notnull === 0 && column.pk === 0,
      generated: column.hidden === 2 || column.hidden === 3,
    })),
    // Explicit indexes carry their DDL (quoted with double quotes, as PostgreSQL reported it);
    // the ones SQLite creates for UNIQUE and PRIMARY KEY column constraints have none.
    indexes: indexSql
      .filter((index) => index.sql !== null)
      .map((index) => ({ name: index.name, definition: (index.sql ?? '').replaceAll('`', '"') })),
    constraints: constraintsOf(definition?.sql ?? '', columns, indexList, foreignKeys),
    triggers,
  };
}
