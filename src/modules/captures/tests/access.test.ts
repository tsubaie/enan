import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDatabase, db } from '@/core/db/client';
import { env } from '@/core/config/env';
import { id } from '@/core/db/ids';
import { migrateDatabase } from '@/core/db/migrate';
import { clearDatabase } from '@/core/db/reset';
import { AppError } from '@/core/http/errors';
import type { User } from '@/core/http/user-schema';
import { assertCaptureAccess, canMutateCapture, canViewCapture } from '../access';
import { visibleCaptures } from '../repo';
import { captures } from '../schema/db';
import * as api from '../api';
import { capture, queuedJob, suggestion, user } from './fixtures';
// CAPTURES-B02: the handlers as a route would export them, against the real database; the
// session is the one seam replaced.
const session = vi.hoisted(() => ({ user: null as User | null }));
vi.mock('@/core/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/auth/session')>()),
  currentUser: async () => session.user,
}));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
beforeAll(() => migrateDatabase());
beforeEach(() => clearDatabase());
afterAll(() => closeDatabase());
const get = async (handler: typeof api.count, path: string, params: Record<string, string>) => {
  const response = await handler(
    new Request(new URL(`/api/v1${path}`, env().APP_URL), {
      headers: { Origin: env().APP_URL, 'X-Requested-With': 'Enan' },
    }),
    { params: Promise.resolve(params) },
  );
  return { status: response.status, body: await response.json() };
};
const as = async (reader: User, path: string, captureId: string) => {
  session.user = reader;
  return get(api.detail, path, { id: captureId });
};
async function cast() {
  const recorder = await user('Recorder', 'member');
  const other = await user('Other Member', 'member');
  const admin = await user('Administrator', 'admin');
  return { recorder, other, admin };
}
it('CAPTURES-B02 the recorder and an admin can view a draft; another member cannot', async () => {
  const { recorder, other, admin } = await cast();
  const row = await capture(recorder);
  expect(canViewCapture(recorder, row)).toBe(true);
  expect(canViewCapture(admin, row)).toBe(true);
  expect(canViewCapture(other, row)).toBe(false);
  expect(canMutateCapture(other, row)).toBe(false);
  expect(canViewCapture(recorder, { ...row, deletedAt: new Date() })).toBe(false);
  expect(canViewCapture(admin, undefined)).toBe(false);
  const detail = `/captures/${row.id}`;
  expect(await as(recorder, detail, row.id)).toMatchObject({
    status: 200,
    body: { data: { id: row.id, createdBy: recorder.id, status: 'queued' } },
  });
  expect((await as(admin, detail, row.id)).status).toBe(200);
});
it('CAPTURES-B02 someone else’s, a missing and a deleted capture all answer not_found, never forbidden', async () => {
  const { recorder, other } = await cast();
  const row = await capture(recorder);
  const gone = await capture(recorder, { deletedAt: new Date(), deletedOpId: id() });
  const refused = { status: 404, body: { error: { code: 'not_found' } } };
  expect(await as(other, `/captures/${row.id}`, row.id)).toMatchObject(refused);
  expect(await as(recorder, `/captures/${gone.id}`, gone.id)).toMatchObject(refused);
  const missing = id();
  expect(await as(recorder, `/captures/${missing}`, missing)).toMatchObject(refused);
  expect(() => assertCaptureAccess(other, row)).toThrow(
    expect.objectContaining({ code: 'not_found', details: { entityType: 'capture' } }),
  );
  expect(() => assertCaptureAccess(other, row)).toThrow(AppError);
});
it('CAPTURES-B02 the list predicate agrees with the row check for every reader', async () => {
  const { recorder, other, admin } = await cast();
  const rows = [
    await capture(recorder),
    await capture(other),
    await capture(admin),
    await capture(recorder, { deletedAt: new Date(), deletedOpId: id() }),
  ];
  for (const reader of [recorder, other, admin]) {
    const listed = await db()
      .select({ id: captures.id })
      .from(captures)
      .where(visibleCaptures(reader))
      .orderBy(captures.id);
    const checked = rows.filter((row) => canViewCapture(reader, row)).map((row) => row.id);
    expect(listed.map((row) => row.id)).toEqual(checked.sort());
  }
  const admins = await db()
    .select({ id: captures.id })
    .from(captures)
    .where(and(visibleCaptures(admin), eq(captures.createdBy, recorder.id)));
  expect(admins).toHaveLength(1);
});
it('CAPTURES-B02 the review count holds only the reader’s own pending drafts and failed captures', async () => {
  const { recorder, other, admin } = await cast();
  const ready = await capture(recorder, { status: 'ready' });
  await suggestion(ready.id);
  await suggestion(ready.id, { kind: 'meeting_note', payload: { title: 'Board', body: 'x' } });
  await suggestion(ready.id, { status: 'discarded' });
  await suggestion(ready.id, { deletedAt: new Date(), deletedOpId: id() });
  await capture(recorder, { status: 'failed', errorCode: 'no_speech' });
  // Still waiting on a live job: not failed, so not counted.
  await capture(recorder, { status: 'transcribing', transcribeJobId: await queuedJob() });
  const deleted = await capture(recorder, {
    status: 'ready',
    deletedAt: new Date(),
    deletedOpId: id(),
  });
  await suggestion(deleted.id);
  const theirs = await capture(other, { status: 'ready' });
  await suggestion(theirs.id);
  const count = async (reader: User) => {
    session.user = reader;
    return (await get(api.count, '/captures/count', {})).body;
  };
  expect(await count(recorder)).toEqual({ data: { pending: 3 } });
  expect(await count(other)).toEqual({ data: { pending: 1 } });
  // §9 decision 6: an admin's badge is their own drafts too, not the workspace's.
  expect(await count(admin)).toEqual({ data: { pending: 0 } });
  session.user = null;
  expect((await get(api.count, '/captures/count', {})).status).toBe(401);
});
