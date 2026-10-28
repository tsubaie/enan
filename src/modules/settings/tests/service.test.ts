import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
import { closeDatabase, db, withTransaction, type Database } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { clearDatabase } from '@/core/db/reset';
import { insertUser } from '@/core/db/auth-repo';
import { User } from '@/core/http/user-schema';
import { id } from '@/core/db/ids';
import { schedules } from '@/core/db/system-schema';
import { listSettings, updateSetting } from '../service';
import { midnightBoundaries } from '../../../../tests/fixtures/timezones';
let admin: User;
let member: User;
const run = <T>(
  user: User,
  action: (ctx: { db: Database; user: User; requestId: string }) => Promise<T>,
) => withTransaction(db(), (database) => action({ db: database, user, requestId: id() }));
beforeAll(async () => {
  await migrateDatabase();
});
beforeEach(async () => {
  await clearDatabase();
  admin = User.parse(
    await insertUser(db(), {
      id: id(),
      name: 'Admin',
      email: 'a@example.test',
      passwordHash: 'x',
      role: 'admin',
    }),
  );
  member = User.parse(
    await insertUser(db(), {
      id: id(),
      name: 'Member',
      email: 'm@example.test',
      passwordHash: 'x',
      role: 'member',
    }),
  );
});
afterAll(() => closeDatabase());
it('ADMIN-B07 settings writes go through the registry: unknown keys, invalid values and members are refused', async () => {
  await expect(
    run(admin, (ctx) => updateSetting(ctx, 'workspace.unknown', 'x')),
  ).rejects.toMatchObject({
    code: 'validation_failed',
  });
  await expect(
    run(admin, (ctx) => updateSetting(ctx, 'retention.trash_days', -1)),
  ).rejects.toThrow();
  await expect(
    run(member, (ctx) => updateSetting(ctx, 'workspace.name', 'Nope')),
  ).rejects.toMatchObject({
    code: 'forbidden',
  });
  await expect(run(admin, (ctx) => updateSetting(ctx, 'user.locale', 'ar'))).rejects.toMatchObject({
    code: 'forbidden',
  });
  const written = await run(admin, (ctx) => updateSetting(ctx, 'workspace.name', 'Audited Office'));
  expect(written).toMatchObject({ key: 'workspace.name', value: 'Audited Office' });
  const listed = await run(admin, (ctx) => listSettings(ctx));
  expect(listed.find((item) => item.key === 'workspace.name')?.value).toBe('Audited Office');
  expect(listed.find((item) => item.key === 'retention.trash_days')?.value).toBe(30);
  expect(listed.some((item) => item.key.startsWith('user.'))).toBe(false);
});
it('PEOPLE-I04 the principal must name a person who exists and is not in the trash', async () => {
  await expect(
    run(admin, (ctx) => updateSetting(ctx, 'workspace.principal_person_id', id())),
  ).rejects.toMatchObject({ code: 'rule_violation', details: { reason: 'unknown_person' } });
});
it('NOTIF-B05 ADMIN-B07 a new workspace time zone moves the reminder schedules with it, so the next run is the first in the new zone, and leaves the system jobs on UTC', async () => {
  const zone = midnightBoundaries[1]?.timezone ?? 'UTC';
  // Every schedule last ran yesterday; only the reminders' clock is reset by the move.
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const seed = (kind: string, cron: string) => ({
    id: id(),
    kind,
    cron,
    timezone: 'UTC',
    payload: {},
    lastOccurrence: yesterday,
  });
  await db()
    .insert(schedules)
    .values([
      seed('tasks.reminders', '0 4 * * *'),
      seed('kpis.reminders', '0 5 * * *'),
      seed('system.backup', '0 2 * * *'),
    ]);
  const before = Date.now();
  await run(admin, (ctx) => updateSetting(ctx, 'workspace.timezone', zone));
  const rows = Object.fromEntries(
    (await db().select().from(schedules)).map((row) => [row.kind, row]),
  );
  expect(Object.fromEntries(Object.values(rows).map((row) => [row.kind, row.timezone]))).toEqual({
    'tasks.reminders': zone,
    'kpis.reminders': zone,
    'system.backup': 'UTC',
  });
  for (const kind of ['tasks.reminders', 'kpis.reminders']) {
    const at = rows[kind]?.lastOccurrence?.getTime() ?? 0;
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  }
  expect(rows['system.backup']?.lastOccurrence).toEqual(yesterday);
});
