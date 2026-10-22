import { report, finish } from './lib/report';
import { baseline, readMigrations, type Migration } from '../build/schema-labels';

// ADMIN-B55, ADR 0050: a migration the previous release cannot run on must say so. A destructive
// statement needs `-- enan:contract` (the image is labelled, and the updater never rolls back
// across it) or `-- enan:compatible <why>` (for example a table rebuild that keeps every column).
export function evaluateMigrations(migrations: Migration[]) {
  const result = report('audit:migrations');
  for (const migration of migrations) {
    if (migration.position <= baseline) continue;
    const file = `drizzle/${migration.tag}.sql`;
    if (migration.marker?.kind === 'compatible' && !migration.marker.reason)
      result.violations.push({
        rule: 'compatible-reason',
        file,
        message: '`-- enan:compatible` needs a reason on the same line',
      });
    if (migration.destructive.length && !migration.marker)
      result.violations.push({
        rule: 'rollback-compatibility',
        file,
        message: `${migration.destructive.join(', ')} can break the previous release (ADR 0050); mark it \`-- enan:contract\` or \`-- enan:compatible <why>\``,
      });
  }
  return result;
}

if (process.argv[1]?.endsWith('migrations.ts'))
  finish(evaluateMigrations(readMigrations(process.cwd())));
