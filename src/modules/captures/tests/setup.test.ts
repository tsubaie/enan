import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { closeDatabase, db } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { clearDatabase } from '@/core/db/reset';
import { getSetting, writeSetting } from '@/core/db/settings-repo';
import { settings } from '@/core/db/system-schema';
import type { User } from '@/core/http/user-schema';
import { captureSetup, readerCapture, requireRecording } from '../setup';
import { user } from './fixtures';
// CAPTURES-B14 CAPTURES-B15: what the shell is told about recording, from the workspace switch and
// the reader's own two, against the real settings table. The read-only handle is the one seam, so
// a database that cannot be read can be stood in for.
const broken = vi.hoisted(() => ({ on: false }));
vi.mock('@/core/db/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/db/client')>();
  return {
    ...actual,
    readOnlyDb: () => {
      if (broken.on) throw new Error('no such table: settings');
      return actual.readOnlyDb();
    },
  };
});
beforeAll(() => migrateDatabase());
afterAll(() => closeDatabase());
let reader: User;
let admin: User;
beforeEach(async () => {
  broken.on = false;
  await clearDatabase();
  reader = await user('Reader', 'member');
  admin = await user('Administrator', 'admin');
});
const cases = [true, false].flatMap((workspace) =>
  [true, false].flatMap((own) => [true, false].map((shortcut) => ({ workspace, own, shortcut }))),
);
it.each(cases)(
  'CAPTURES-B14 CAPTURES-B15 workspace $workspace, own $own, shortcut $shortcut',
  async ({ workspace, own, shortcut }) => {
    await writeSetting(db(), 'captures.enabled', workspace, admin.id);
    await writeSetting(db(), 'user.captures.enabled', own, reader.id, reader.id);
    await writeSetting(db(), 'user.captures.shortcut', shortcut, reader.id, reader.id);
    const expected = {
      allowed: workspace,
      enabled: workspace && own,
      shortcut: workspace && own && shortcut,
    };
    expect(await captureSetup(db(), reader.id)).toEqual(expected);
    expect(await readerCapture(reader.id)).toEqual(expected);
  },
);
it('CAPTURES-B15 with no rows recording and the shortcut are on, and one reader’s switch is not another’s', async () => {
  expect(await captureSetup(db(), reader.id)).toEqual({
    allowed: true,
    enabled: true,
    shortcut: true,
  });
  await writeSetting(db(), 'user.captures.enabled', false, reader.id, reader.id);
  expect((await captureSetup(db(), admin.id)).enabled).toBe(true);
});
it('CAPTURES-B14 a database that cannot be read draws the built-in defaults, but refuses audio', async () => {
  broken.on = true;
  expect(await readerCapture(reader.id)).toEqual({ allowed: true, enabled: true, shortcut: true });
  const unreadable = {
    select: () => {
      throw new Error('no such table: settings');
    },
  };
  await expect(
    // cast: a handle whose every read fails, which is all this check needs of it
    requireRecording({ user: reader, db: unreadable as never }),
  ).rejects.toThrow('no such table');
});
it('CAPTURES-B14 requireRecording names the scope that turned recording off', async () => {
  await expect(requireRecording({ user: reader, db: db() })).resolves.toBeUndefined();
  await writeSetting(db(), 'user.captures.enabled', false, reader.id, reader.id);
  await expect(requireRecording({ user: reader, db: db() })).rejects.toMatchObject({
    code: 'forbidden',
    details: { reason: 'recording_off', scope: 'account' },
  });
  await writeSetting(db(), 'captures.enabled', false, admin.id);
  await expect(requireRecording({ user: reader, db: db() })).rejects.toMatchObject({
    details: { reason: 'recording_off', scope: 'workspace' },
  });
});
it('CAPTURES-B14 captures.inbox neither decides recording nor is written by it', async () => {
  const before = await captureSetup(db(), reader.id);
  await writeSetting(db(), 'captures.inbox', false, admin.id);
  expect(await captureSetup(db(), reader.id)).toEqual(before);
  await writeSetting(db(), 'captures.inbox', true, admin.id);
  await writeSetting(db(), 'captures.enabled', false, admin.id);
  await readerCapture(reader.id);
  await requireRecording({ user: reader, db: db() }).catch(() => undefined);
  const keys = (await db().select().from(settings)).map((row) => row.key);
  expect(keys.filter((key) => key === 'captures.inbox')).toHaveLength(1);
  expect(await getSetting(db(), 'captures.inbox')).toBe(true);
});
