// ADMIN-B55, ADR 0050: what the migrations allow a rollback to do. Dependency-free, so CI's image
// job runs it with plain Node (`node scripts/build/schema-labels.ts`) and audit:migrations imports it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Migrations up to this position predate ADR 0050 and are not checked; 0001 rewrote `files`.
export const baseline = 7;

const destructive: { name: string; pattern: RegExp }[] = [
  { name: 'DROP TABLE', pattern: /\bdrop\s+table\b/iu },
  { name: 'DROP COLUMN', pattern: /\bdrop\s+column\b/iu },
  { name: 'RENAME', pattern: /\brename\s+(?:column|to)\b/iu },
  { name: 'DROP INDEX', pattern: /\bdrop\s+index\b/iu },
  { name: 'DROP VIEW', pattern: /\bdrop\s+view\b/iu },
  { name: 'DROP TRIGGER', pattern: /\bdrop\s+trigger\b/iu },
];

export type Marker = { kind: 'contract' } | { kind: 'compatible'; reason: string } | null;

export type Migration = {
  // 1-based: the schema an image carries is the number of migrations it applies.
  position: number;
  tag: string;
  destructive: string[];
  marker: Marker;
};

export function classify(sql: string): { destructive: string[]; marker: Marker } {
  const marker = sql.match(/^--\s*enan:(contract|compatible)\b[ \t]*(.*)$/imu);
  const statements = sql.replace(/--.*$/gmu, '');
  return {
    destructive: destructive.filter(({ pattern }) => pattern.test(statements)).map((d) => d.name),
    marker: !marker
      ? null
      : marker[1]?.toLowerCase() === 'contract'
        ? { kind: 'contract' }
        : { kind: 'compatible', reason: (marker[2] ?? '').trim() },
  };
}

export function readMigrations(root: string): Migration[] {
  // CI runs this file with plain Node, before any install, so it cannot use zod.
  const journal: { entries: { idx: number; tag: string }[] } = JSON.parse(
    readFileSync(join(root, 'drizzle/meta/_journal.json'), 'utf8'),
  );
  return journal.entries.map((entry) => ({
    position: entry.idx + 1,
    tag: entry.tag,
    ...classify(readFileSync(join(root, 'drizzle', `${entry.tag}.sql`), 'utf8')),
  }));
}

// `schema`: how many migrations the image applies. `contract`: the position of its newest
// migration that the release before it cannot run on, 0 for none. Going back from image C to an
// image R is safe exactly when C.contract <= R.schema.
export function schemaLabels(migrations: Migration[]) {
  return {
    schema: migrations.length,
    contract: Math.max(
      0,
      ...migrations.filter((m) => m.marker?.kind === 'contract').map((m) => m.position),
    ),
  };
}

if (process.argv[1]?.endsWith('schema-labels.ts')) {
  const labels = schemaLabels(readMigrations(process.cwd()));
  process.stdout.write(`schema=${labels.schema}\ncontract=${labels.contract}\n`);
}
