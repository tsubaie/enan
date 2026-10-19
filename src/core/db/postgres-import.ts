import 'server-only';
import { getTableColumns, getTableName, is, sql } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import { databaseFor, type DatabaseClient } from './client';
import { migrateDatabase } from './migrate';
import * as system from './system-schema';

// Carries the rows of a PostgreSQL ExecutiveOS database (the schema before ADR 0029, exported by
// scripts/db/export-postgres.sh) into a new SQLite file. Every row goes through the Drizzle
// schema, so it gets the conversions the app applies; every CHECK, unique index and the
// task-depth trigger apply to it; foreign keys are checked at commit. `search_text` is not
// carried over but recomputed with each module's corpus (the repos' corpusOf). The result is
// verified before the caller trusts it: counts, every row read back as written, integrity and
// foreign keys.
export type Value = z.core.util.JSONType | Date;
export type Row = Record<string, Value>;
type Column = { name: string; columnType: string; notNull: boolean; hasDefault: boolean };
export const SourceRow = z.record(z.string(), z.json());

const converters: Record<string, z.ZodType<Value>> = {
  SQLiteTimestamp: z.iso
    .datetime({ offset: true, local: true })
    .transform((value) => new Date(value)),
  SQLiteBoolean: z.boolean(),
  SQLiteTextJson: z.json(),
  SQLiteInteger: z.number(),
  SQLiteReal: z.number(),
  SQLiteText: z.string(),
};

// The tables and search corpora to import into: the system tables here, the modules' from the
// caller (core does not reach into modules; scripts/db/postgres-import-targets.ts assembles them).
export type ImportTarget = {
  tables: Map<string, SQLiteTable>;
  corpus: Record<string, (row: Row) => string>;
};
// Every table a schema module exports, by name.
export function tablesOf(...schemas: object[]) {
  const tables = new Map<string, SQLiteTable>();
  for (const schema of schemas)
    for (const value of Object.values(schema))
      if (is(value, SQLiteTable)) tables.set(getTableName(value), value);
  return tables;
}
export function withSystemTables(tables: Map<string, SQLiteTable>) {
  const all = new Map(tables);
  for (const value of Object.values(system))
    if (is(value, SQLiteTable)) all.set(getTableName(value), value);
  return all;
}
function columnsOf(table: SQLiteTable) {
  const columns: Record<string, Column> = getTableColumns(table);
  return columns;
}
function convert(table: string, column: Column, value: z.core.util.JSONType | undefined) {
  if (value === null || value === undefined) return null;
  const converter = converters[column.columnType];
  if (!converter)
    throw new Error(`${table}.${column.name}: no conversion for ${column.columnType}`);
  const parsed = converter.safeParse(value);
  if (!parsed.success)
    throw new Error(
      `${table}.${column.name}: ${JSON.stringify(value)} is not a ${column.columnType}`,
    );
  return parsed.data;
}
// One source row as the row to insert, recording source fields that have no target column.
function targetRow(
  name: string,
  columns: Record<string, Column>,
  source: z.infer<typeof SourceRow>,
  dropped: Set<string>,
  corpus: ImportTarget['corpus'],
) {
  const row: Row = {};
  const used = new Set(['search_text']);
  for (const [key, column] of Object.entries(columns)) {
    used.add(column.name);
    if (column.name === 'search_text') continue;
    if (column.name in source) row[key] = convert(name, column, source[column.name]);
    else if (column.notNull && !column.hasDefault)
      throw new Error(`${name}: a row has no ${column.name}`);
  }
  for (const field of Object.keys(source)) if (!used.has(field)) dropped.add(`${name}.${field}`);
  if ('searchText' in columns) {
    const of = corpus[name];
    if (!of) throw new Error(`${name} has search_text but no corpus here`);
    row.searchText = of(row);
  }
  return row;
}
// One row as comparable text: columns in key order, dates as epoch milliseconds.
function canonical(row: Row, keys: string[]) {
  return JSON.stringify(
    keys.map((key) => {
      const value = row[key];
      return value instanceof Date ? value.getTime() : (value ?? null);
    }),
  );
}
async function verify(
  client: DatabaseClient,
  written: Map<string, Row[]>,
  tables: Map<string, SQLiteTable>,
) {
  const database = databaseFor(client);
  for (const [name, table] of tables) {
    // The columns every written row set (an export carries them all; a default fills the rest).
    const rows = written.get(name) ?? [];
    const keys = Object.keys(columnsOf(table)).filter((key) => rows.every((row) => key in row));
    const stored = (await database.select().from(table)) as Row[]; // cast: a whole-table select of a schema table
    const want = rows.map((row) => canonical(row, keys)).sort();
    const have = stored.map((row) => canonical(row, keys)).sort();
    if (want.length !== have.length)
      throw new Error(`${name}: ${have.length} rows stored, ${want.length} written`);
    const differ = want.findIndex((value, i) => value !== have[i]);
    if (differ !== -1)
      throw new Error(`${name}: a stored row differs from the row written: ${want[differ]}`);
  }
  const integrity = await client.execute('pragma integrity_check');
  const foreign = await client.execute('pragma foreign_key_check');
  if (integrity.rows[0]?.[0] !== 'ok')
    throw new Error(`integrity_check: ${JSON.stringify(integrity.rows)}`);
  if (foreign.rows.length) throw new Error(`foreign_key_check: ${JSON.stringify(foreign.rows)}`);
}
// `source` maps every table name to its exported rows. Throws before anything is trusted when a
// table or column has no counterpart (unless the column is in `allowDrop`) or a check fails.
export async function importPostgres(
  client: DatabaseClient,
  source: Map<string, z.infer<typeof SourceRow>[]>,
  target: ImportTarget,
  allowDrop: ReadonlySet<string> = new Set(),
) {
  const tables = withSystemTables(target.tables);
  const missing = [...tables.keys()].filter((name) => !source.has(name));
  const unknown = [...source.keys()].filter((name) => !tables.has(name));
  if (missing.length || unknown.length)
    throw new Error(
      `tables differ: no export for [${missing.join(', ')}]; no target for [${unknown.join(', ')}]`,
    );
  await migrateDatabase(client);
  const dropped = new Set<string>();
  const written = new Map<string, Row[]>();
  await databaseFor(client).transaction(
    async (tx) => {
      await tx.run(sql`pragma defer_foreign_keys = on`);
      for (const [name, table] of tables) {
        const columns = columnsOf(table);
        const rows = (source.get(name) ?? []).map((row) =>
          targetRow(name, columns, row, dropped, target.corpus),
        );
        for (let start = 0; start < rows.length; start += 100)
          await tx.insert(table).values(rows.slice(start, start + 100));
        written.set(name, rows);
      }
      const refused = [...dropped].filter((field) => !allowDrop.has(field));
      if (refused.length) throw new Error(`source columns with no target: ${refused.join(', ')}`);
    },
    { behavior: 'immediate' },
  );
  await verify(client, written, tables);
  return {
    counts: new Map([...written].map(([name, rows]) => [name, rows.length])),
    dropped: [...dropped],
  };
}
