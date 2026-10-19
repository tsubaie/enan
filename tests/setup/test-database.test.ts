import { it, expect } from 'vitest';
import { assertTestDatabase, databasePath, isTestDatabaseUrl } from '@/core/db/test-database';
it('refuses a database file whose basename lacks the _test.db suffix', () => {
  expect(() => assertTestDatabase('file:./tmp/executiveos.db')).toThrow(/_test\.db/);
  expect(() => assertTestDatabase('file:/var/lib/executiveos/data/production_test_.db')).toThrow();
  expect(() => assertTestDatabase('file:./tmp/executiveos_test')).toThrow();
  expect(assertTestDatabase('file:./tmp/executiveos_test.db').name).toBe('executiveos_test.db');
  expect(isTestDatabaseUrl('file:./tmp/executiveos_test.db?mode=rwc')).toBe(true);
  expect(isTestDatabaseUrl('file:./tmp/_test.db/executiveos.db')).toBe(false);
});
it('resolves every file: URL form libsql accepts to the same local path', () => {
  expect(databasePath('file:./tmp/dev.db')).toBe('./tmp/dev.db');
  expect(databasePath('file:/var/lib/executiveos/data/executiveos.db')).toBe(
    '/var/lib/executiveos/data/executiveos.db',
  );
  expect(databasePath('file:///var/lib/executiveos/data/executiveos.db')).toBe(
    '/var/lib/executiveos/data/executiveos.db',
  );
  expect(databasePath('file://localhost/var/lib/x.db')).toBe('/var/lib/x.db');
  expect(databasePath('file:./tmp/a%20b.db?mode=ro')).toBe('./tmp/a b.db');
});
