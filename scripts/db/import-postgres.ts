import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '../../src/core/config/env';
import { openClient } from '../../src/core/db/client';
import { importPostgres, SourceRow } from '../../src/core/db/postgres-import';
import { moduleTargets } from './postgres-import-targets';
// Moves a PostgreSQL ExecutiveOS database (before ADR 0029) into a new SQLite file
// (src/core/db/postgres-import.ts does the work and the checks). Input: the directory
// scripts/db/export-postgres.sh wrote. The target file must not exist.
//
//   DATABASE_URL=file:/path/executiveos.db SESSION_SECRET=… node --conditions=react-server \
//     --import tsx scripts/db/import-postgres.ts <export dir> [--allow-drop table.column]…
const args = process.argv.slice(2);
const allowDrop = new Set(args.flatMap((arg, i) => (args[i - 1] === '--allow-drop' ? [arg] : [])));
const [dir] = args.filter((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--allow-drop');
if (!dir || !existsSync(join(dir, 'counts.txt')))
  throw new Error(
    'Pass the export directory: import-postgres.ts <dir> [--allow-drop table.column]…',
  );
const url = env().DATABASE_URL;
if (!url.startsWith('file:'))
  throw new Error('DATABASE_URL must be a file: URL for the new database');
if (existsSync(url.slice('file:'.length)))
  throw new Error(`${url} already exists; import into a new file`);

const expected = new Map<string, number>();
for (const line of (await readFile(join(dir, 'counts.txt'), 'utf8')).trim().split('\n')) {
  const [name = '', rows = ''] = line.split(' ');
  expected.set(name, Number(rows));
}
const source = new Map<string, ReturnType<typeof SourceRow.parse>[]>();
for (const name of expected.keys()) {
  const lines = (await readFile(join(dir, `${name}.ndjson`), 'utf8')).split('\n').filter(Boolean);
  source.set(
    name,
    lines.map((line) => SourceRow.parse(JSON.parse(line))),
  );
}
const client = openClient(url, 1);
const { counts, dropped } = await importPostgres(client, source, moduleTargets(), allowDrop);
client.close();
for (const [name, rows] of counts) {
  if (rows !== expected.get(name))
    throw new Error(`${name}: ${rows} imported, ${expected.get(name)} exported`);
  process.stdout.write(`${name}: ${rows}\n`);
}
process.stdout.write(
  `import-postgres: ${counts.size} tables; counts match the export, every row reads back as written, integrity and foreign keys ok${dropped.length ? `; dropped (allowed): ${dropped.join(', ')}` : ''}\n`,
);
