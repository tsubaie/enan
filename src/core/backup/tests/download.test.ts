import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { auditLog, users } from '@/core/db/system-schema';
import { closeDatabase, databaseFor, pool } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { User } from '@/core/http/user-schema';
import { backupDownload } from '@/core/http/backup-download';
import { createBackup } from '../dump';
import { bufferNames, rewriteManifest, workspace, writeTree } from './fixtures/archive';
const config = vi.hoisted(() => ({
  NODE_ENV: 'test',
  DATABASE_URL: '',
  FILES_DIR: '',
  BACKUP_DIR: '',
  FILES_QUOTA_GB: 20,
}));
const session = vi.hoisted(() => ({ role: 'admin' as 'admin' | 'member', id: '' }));
vi.mock('@/core/config/env', () => ({ env: () => config }));
vi.mock('@/core/auth/session', () => ({
  currentUser: async () =>
    User.parse({
      id: session.id,
      role: session.role,
      email: 'admin@example.test',
      name: 'Admin',
      isActive: true,
      revision: 1,
    }),
}));
let space: Awaited<ReturnType<typeof workspace>>;
beforeEach(async () => {
  space = await workspace();
  Object.assign(config, {
    DATABASE_URL: `file:${join(space.root, 'data', 'live_test.db')}`,
    FILES_DIR: space.files,
    BACKUP_DIR: space.backups,
  });
  await writeTree(space.files, { 'doc.txt': 'document' });
  await migrateDatabase(pool());
  session.role = 'admin';
  session.id = crypto.randomUUID();
  await databaseFor(pool()).insert(users).values({
    id: session.id,
    email: 'admin@example.test',
    name: 'Admin',
    passwordHash: 'x',
    role: 'admin',
  });
});
afterEach(async () => {
  closeDatabase();
  await space.dispose();
});
const download = (backupId: string) =>
  backupDownload(new Request(`http://localhost/api/v1/admin/backups/${backupId}/download`), {
    params: Promise.resolve({ id: backupId }),
  });
it('ADMIN-B44 a member is refused the download with 403', async () => {
  const backupId = crypto.randomUUID();
  await createBackup(backupId);
  session.role = 'member';
  expect((await download(backupId)).status).toBe(403);
});
it('ADMIN-B44 an unknown, invalid or no-longer-verifying backup id is 404', async () => {
  expect((await download(crypto.randomUUID())).status).toBe(404);
  expect((await download('../etc')).status).toBe(404);
  const backupId = crypto.randomUUID();
  await createBackup(backupId);
  await rewriteManifest(join(space.backups, backupId), (value) => {
    value.files['db.sqlite']!.sha256 = '0'.repeat(64);
  });
  expect((await download(backupId)).status).toBe(404);
});
it('ADMIN-B44 a valid backup streams one tar of manifest, database and files, named by date, and is audited', async () => {
  const backupId = crypto.randomUUID();
  const manifest = await createBackup(backupId);
  const response = await download(backupId);
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toBe('application/x-tar');
  expect(response.headers.get('Content-Disposition')).toBe(
    `attachment; filename="enan-backup-${manifest.createdAt.slice(0, 10)}.tar"`,
  );
  const entries = await bufferNames(Buffer.from(await response.arrayBuffer()));
  expect(entries.map((name) => name.replace(/\/$/u, '')).sort()).toEqual(
    [
      backupId,
      `${backupId}/db.sqlite`,
      `${backupId}/files.tar`,
      `${backupId}/manifest.json`,
    ].sort(),
  );
  const audit = await databaseFor(pool())
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, 'download'), eq(auditLog.entityId, backupId)));
  expect(audit).toHaveLength(1);
  expect(audit[0]?.actorId).toBe(session.id);
});
