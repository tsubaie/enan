import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { closeDatabase, db, withTransaction } from '@/core/db/client';
import { clearDatabase } from '@/core/db/reset';
import { migrateDatabase } from '@/core/db/migrate';
import { insertUser } from '@/core/db/auth-repo';
import { getSetting, writeSetting } from '@/core/db/settings-repo';
import { id } from '@/core/db/ids';
import { env } from '@/core/config/env';
import { User } from '@/core/http/user-schema';
import { addDays, dayAt } from '@/core/time/notes';
import { createPerson } from '@/modules/people';
import { PersonCreate, personDraft } from '@/modules/people/schema/validation';
import { NoteList } from '../schema/validation';
import * as api from '../api';
// The route handlers are exercised the way Next calls them: a real `Request` against the real
// database, with only the cookie session and the error translator stood in for, so the contract
// pinned here (status, envelope, headers, guards) is the one the browser sees.
const session = vi.hoisted(() => ({ user: null as User | null }));
vi.mock('@/core/auth/session', () => ({ currentUser: async () => session.user }));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
let admin: User;
let member: User;
beforeAll(() => migrateDatabase());
beforeEach(async () => {
  await clearDatabase();
  admin = User.parse(
    await insertUser(db(), {
      id: id(),
      name: 'Notes Admin',
      email: 'notes-admin@example.test',
      passwordHash: 'unused-test-hash',
      role: 'admin',
    }),
  );
  member = User.parse(
    await insertUser(db(), {
      id: id(),
      name: 'Notes Member',
      email: 'notes-member@example.test',
      passwordHash: 'unused-test-hash',
      role: 'member',
    }),
  );
  session.user = admin;
});
afterAll(() => closeDatabase());
type Handler = (
  request: Request,
  route?: { params: Promise<Record<string, string>> },
) => Promise<Response>;
type Json = z.infer<ReturnType<typeof z.json>>;
type Options = {
  body?: Json;
  key?: string | null;
  origin?: string;
  requestedWith?: string | null;
  params?: Record<string, string>;
};
async function call(handler: Handler, method: string, path: string, options: Options = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (method !== 'GET') {
    headers.Origin = options.origin ?? env().APP_URL;
    if (options.requestedWith !== null)
      headers['X-Requested-With'] = options.requestedWith ?? 'ExecutiveOS';
  }
  if (options.key !== null) headers['Idempotency-Key'] = options.key ?? id();
  const request = new Request(new URL(`/api/v1${path}`, env().APP_URL), {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const response = await handler(
    request,
    options.params ? { params: Promise.resolve(options.params) } : undefined,
  );
  return {
    status: response.status,
    headers: response.headers,
    body: response.status === 204 ? null : await response.json(),
  };
}
const create = (body: Json, options: Options = {}) =>
  call(api.create, 'POST', '/notes', { body, ...options });
const detail = (noteId: string, query = '') =>
  call(api.detail, 'GET', `/notes/${noteId}${query}`, { params: { id: noteId } });
const list = (query = '') => call(api.list, 'GET', `/notes${query}`);
async function note(title: string, fields: Record<string, Json> = {}) {
  const created = await create({ title, ...fields });
  expect(created.status).toBe(201);
  return created.body.data as { id: string; revision: number; tags: string[] };
}
async function person(fullName: string, fields: Partial<PersonCreate> = {}) {
  const created = await withTransaction(db(), (database) =>
    createPerson(
      { db: database, user: admin, requestId: id() },
      PersonCreate.parse({ ...personDraft(fullName), ...fields }),
    ),
  );
  if (!created.data) throw new Error('person not created');
  return created.data;
}
async function workspaceToday() {
  return dayAt(await getSetting(db(), 'workspace.timezone'));
}
// docs/04 § Resources and verbs: the guard, status and idempotency of every endpoint are part of
// the contract OpenAPI is generated from, so they are pinned rather than left to review.
type Meta = { guard: string; status: number; idempotent: boolean; enqueues: boolean };
const meta = (handler: { meta: Meta }) => ({
  guard: handler.meta.guard,
  status: handler.meta.status,
  idempotent: handler.meta.idempotent,
});
it('NOTES-B01 NOTES-B07 NOTES-B10 NOTES-B11 NOTES-B12 NOTES-B13 NOTES-B20 NOTES-B27 every note endpoint is session guarded and every write but delete is idempotent', () => {
  const session200 = { guard: 'session', status: 200, idempotent: false };
  expect(meta(api.list)).toEqual(session200);
  expect(meta(api.detail)).toEqual(session200);
  expect(meta(api.tags)).toEqual(session200);
  expect(meta(api.types)).toEqual(session200);
  expect(meta(api.templates)).toEqual(session200);
  expect(meta(api.create)).toEqual({ guard: 'session', status: 201, idempotent: true });
  expect(meta(api.patch)).toEqual({ guard: 'session', status: 200, idempotent: true });
  expect(meta(api.restore)).toEqual({ guard: 'session', status: 200, idempotent: true });
  expect(meta(api.archive)).toEqual({ guard: 'session', status: 200, idempotent: true });
  expect(meta(api.unarchive)).toEqual({ guard: 'session', status: 200, idempotent: true });
  expect(meta(api.bulkArchive)).toEqual({ guard: 'session', status: 200, idempotent: true });
  expect(meta(api.bulkTag)).toEqual({ guard: 'session', status: 200, idempotent: true });
  // A delete answers 204 and carries its operation id in a header (docs/04 § Resources).
  expect(meta(api.remove)).toEqual({ guard: 'session', status: 204, idempotent: false });
});
it('NOTES-B17 NOTES-B18 NOTES-B21 ADMIN-B28 AI routes enqueue with 202 and tag administration is admin only', () => {
  for (const start of [api.refine, api.suggestTags]) {
    expect(meta(start)).toEqual({ guard: 'session', status: 202, idempotent: false });
    expect(start.meta.enqueues).toBe(true);
  }
  for (const apply of [api.refineApply, api.tagsApply, api.refineRestore])
    expect(meta(apply)).toEqual({ guard: 'session', status: 200, idempotent: true });
  for (const discard of [api.refineDiscard, api.tagsDiscard])
    expect(meta(discard)).toEqual({ guard: 'session', status: 200, idempotent: false });
  expect(meta(api.managedTags)).toEqual({ guard: 'admin', status: 200, idempotent: false });
  expect(meta(api.manageTagSelection)).toEqual({ guard: 'admin', status: 200, idempotent: true });
});
it('NOTES-B01 NOTES-B07 NOTES-I03 creates a note with its defaults, reads it back in the envelope and patches it by revision', async () => {
  const created = await create({ title: '  Board pre-read ', tags: ['Budget', 'budget'] });
  expect(created.status).toBe(201);
  expect(created.headers.get('X-Request-Id')).toBeTruthy();
  expect(created.headers.get('Cache-Control')).toBe('no-store');
  expect(created.body).toEqual({ data: expect.objectContaining({ title: 'Board pre-read' }) });
  expect(created.body.data).toMatchObject({
    revision: 1,
    type: null,
    content: '',
    tags: ['Budget'],
    noteDate: await workspaceToday(),
    participants: [],
    tasks: [],
    archivedAt: null,
    createdBy: admin.id,
  });
  const noteId = created.body.data.id as string;
  const read = await detail(noteId);
  expect(read.status).toBe(200);
  expect(read.body.data.id).toBe(noteId);
  const patched = await call(api.patch, 'PATCH', `/notes/${noteId}`, {
    body: { revision: 1, title: 'Board pre-read, final', content: 'Agenda' },
    params: { id: noteId },
  });
  expect(patched.status).toBe(200);
  expect(patched.body.data).toMatchObject({
    revision: 2,
    title: 'Board pre-read, final',
    content: 'Agenda',
  });
  const listed = await list('?view=all');
  expect(listed.status).toBe(200);
  const parsed = NoteList.parse(listed.body);
  expect(parsed.data.map((row) => row.id)).toEqual([noteId]);
  expect(parsed.meta).toMatchObject({ total: 1, nextCursor: null, counts: { all: 1 } });
});
it('NOTES-I01 NOTES-I03 NOTES-B12 a validation failure answers 400 naming the fields with dotted paths', async () => {
  const blank = await create({ title: '   ' });
  expect(blank.status).toBe(400);
  expect(blank.body.error).toMatchObject({
    code: 'validation_failed',
    details: { fieldErrors: { title: expect.any(Array) } },
  });
  expect(blank.body.error.requestId).toBeTruthy();
  const badParticipant = await create({ title: 'Ok', participantIds: ['not-a-uuid'] });
  expect(badParticipant.status).toBe(400);
  expect(Object.keys(badParticipant.body.error.details.fieldErrors)).toEqual(['participantIds.0']);
  const tooManyTags = await create({
    title: 'Ok',
    tags: Array.from({ length: 11 }, (_, index) => `t${index}`),
  });
  expect(tooManyTags.status).toBe(400);
  expect(Object.keys(tooManyTags.body.error.details.fieldErrors)).toEqual(['tags']);
  const bulk = await call(api.bulkArchive, 'POST', '/notes/bulk/archive', {
    body: { items: [{ id: 'nope', revision: 0 }] },
  });
  expect(bulk.status).toBe(400);
  expect(Object.keys(bulk.body.error.details.fieldErrors).sort()).toEqual([
    'items.0.id',
    'items.0.revision',
  ]);
  // Unknown fields are refused rather than dropped, so a misspelled field cannot be silently lost.
  const unknown = await create({ title: 'Ok', colour: 'red' });
  expect(unknown.status).toBe(400);
  expect(await list('?view=all').then((r) => r.body.meta.total)).toBe(0);
});
it('NOTES-B01 NOTES-B07 refuses an anonymous request with 401 and a foreign origin or a missing app header with 403', async () => {
  session.user = null;
  const anonymousWrite = await create({ title: 'Nobody' });
  expect(anonymousWrite.status).toBe(401);
  expect(anonymousWrite.body.error.code).toBe('unauthenticated');
  expect((await list()).status).toBe(401);
  session.user = admin;
  const foreign = await create(
    { title: 'Elsewhere' },
    { origin: 'https://untrusted.example.test' },
  );
  expect(foreign.status).toBe(403);
  expect(foreign.body.error).toMatchObject({ code: 'forbidden', details: { reason: 'origin' } });
  const plain = await create({ title: 'Plain fetch' }, { requestedWith: null });
  expect(plain.status).toBe(403);
  expect((await list('?view=all')).body.meta.total).toBe(0);
});
it('NOTES-B11 NOTES-B07 delete answers 204 with the op id, the note is 404 until includeDeleted, and restore brings back that row', async () => {
  const created = await note('Trash me', { tags: ['Keep'] });
  const stale = await call(api.remove, 'DELETE', `/notes/${created.id}`, {
    body: { revision: 7 },
    params: { id: created.id },
  });
  expect(stale.status).toBe(409);
  expect(stale.body.error).toMatchObject({ code: 'conflict', details: { reason: 'revision' } });
  const removed = await call(api.remove, 'DELETE', `/notes/${created.id}`, {
    body: { revision: created.revision },
    params: { id: created.id },
  });
  expect(removed.status).toBe(204);
  expect(removed.body).toBeNull();
  const opId = removed.headers.get('X-Op-Id');
  expect(opId).toMatch(/^[0-9a-f-]{36}$/u);
  expect(removed.headers.get('X-Request-Id')).toBeTruthy();
  const gone = await detail(created.id);
  expect(gone.status).toBe(404);
  expect(gone.body.error).toMatchObject({ code: 'not_found', details: { entityType: 'note' } });
  expect((await detail(id())).status).toBe(404);
  const trashed = await detail(created.id, '?includeDeleted=true');
  expect(trashed.status).toBe(200);
  expect(trashed.body.data.deletedAt).not.toBeNull();
  expect(trashed.body.data.deletedOpId).toBe(opId);
  const restored = await call(api.restore, 'POST', `/notes/${created.id}/restore`, {
    body: { opId },
    params: { id: created.id },
  });
  expect(restored.status).toBe(200);
  expect(restored.body.data).toMatchObject({ id: created.id, deletedAt: null, tags: ['Keep'] });
  // A different operation restores nothing: the row belongs to the op that removed it.
  await call(api.remove, 'DELETE', `/notes/${created.id}`, {
    body: { revision: restored.body.data.revision },
    params: { id: created.id },
  });
  const wrongOp = await call(api.restore, 'POST', `/notes/${created.id}/restore`, {
    body: { opId: id() },
    params: { id: created.id },
  });
  expect(wrongOp.status).toBe(409);
  expect(wrongOp.body.error).toMatchObject({ code: 'conflict', details: { reason: 'state' } });
  expect((await detail(created.id)).status).toBe(404);
});
it('NOTES-B07 a stale revision answers 409 with the current row and changes nothing', async () => {
  const created = await note('Agenda');
  await call(api.patch, 'PATCH', `/notes/${created.id}`, {
    body: { revision: 1, title: 'Agenda v2' },
    params: { id: created.id },
  });
  const stale = await call(api.patch, 'PATCH', `/notes/${created.id}`, {
    body: { revision: 1, title: 'Agenda v3' },
    params: { id: created.id },
  });
  expect(stale.status).toBe(409);
  expect(stale.body.error).toMatchObject({
    code: 'conflict',
    details: { reason: 'revision', current: { revision: 2, title: 'Agenda v2' } },
  });
  expect((await detail(created.id)).body.data).toMatchObject({ revision: 2, title: 'Agenda v2' });
});
it('NOTES-B01 an idempotent create replays the stored answer for its key and refuses a different payload under it', async () => {
  const key = id();
  const first = await create({ title: 'Once' }, { key });
  const again = await create({ title: 'Once' }, { key });
  expect(again.status).toBe(201);
  expect(again.body).toEqual(first.body);
  expect((await list('?view=all')).body.meta.total).toBe(1);
  const other = await create({ title: 'Twice' }, { key });
  expect(other.status).toBe(409);
  expect(other.body.error).toMatchObject({ code: 'conflict', details: { reason: 'duplicate' } });
  expect((await list('?view=all')).body.meta.total).toBe(1);
  // The key is the caller's: another user replaying it is a fresh request.
  session.user = member;
  const theirs = await create({ title: 'Once' }, { key });
  expect(theirs.status).toBe(201);
  expect(theirs.body.data.id).not.toBe(first.body.data.id);
  // An idempotent write without a key is refused before anything is written.
  const keyless = await create({ title: 'Keyless' }, { key: null });
  expect(keyless.status).toBe(400);
});
it('NOTES-B10 NOTES-B02 archive and unarchive by revision move the note between All and Archived', async () => {
  const created = await note('Park me');
  const archived = await call(api.archive, 'POST', `/notes/${created.id}/archive`, {
    body: { revision: created.revision },
    params: { id: created.id },
  });
  expect(archived.status).toBe(200);
  expect(archived.body.data.archivedAt).not.toBeNull();
  expect((await list('?view=all')).body.meta.counts).toMatchObject({ all: 0, archived: 1 });
  expect((await list('?view=archived')).body.data.map((row: { id: string }) => row.id)).toEqual([
    created.id,
  ]);
  const unarchived = await call(api.unarchive, 'POST', `/notes/${created.id}/unarchive`, {
    body: { revision: archived.body.data.revision },
    params: { id: created.id },
  });
  expect(unarchived.status).toBe(200);
  expect(unarchived.body.data.archivedAt).toBeNull();
  expect((await list('?view=all')).body.meta.counts).toMatchObject({ all: 1, archived: 0 });
});
it('NOTES-B12 NOTES-I03 bulk archive with one stale revision and bulk tag past ten tags change nothing', async () => {
  const first = await note('First', { tags: ['a'] });
  const second = await note('Second');
  const full = await note('Full', {
    tags: Array.from({ length: 10 }, (_, index) => `t${index}`),
  });
  const stale = await call(api.bulkArchive, 'POST', '/notes/bulk/archive', {
    body: {
      items: [
        { id: first.id, revision: first.revision },
        { id: second.id, revision: second.revision + 5 },
      ],
    },
  });
  expect(stale.status).toBe(409);
  expect(stale.body.error).toMatchObject({
    code: 'conflict',
    details: { reason: 'revision', id: second.id },
  });
  expect((await detail(first.id)).body.data.archivedAt).toBeNull();
  const overflow = await call(api.bulkTag, 'POST', '/notes/bulk/tag', {
    body: {
      items: [
        { id: first.id, revision: first.revision },
        { id: full.id, revision: full.revision },
      ],
      tag: 'Extra',
    },
  });
  expect(overflow.status).toBe(422);
  expect(overflow.body.error).toMatchObject({
    code: 'rule_violation',
    details: { rule: 'NOTES-I03', id: full.id },
  });
  expect((await detail(first.id)).body.data).toMatchObject({ tags: ['a'], revision: 1 });
  const tagged = await call(api.bulkTag, 'POST', '/notes/bulk/tag', {
    body: {
      items: [
        { id: first.id, revision: first.revision },
        { id: second.id, revision: second.revision },
      ],
      tag: 'A',
    },
  });
  expect(tagged.status).toBe(200);
  // The note that already carried the tag in another spelling is left as it is.
  expect(tagged.body).toEqual({ data: { updatedIds: [second.id] } });
  expect((await detail(second.id)).body.data.tags).toEqual(['A']);
});
it('NOTES-B13 NOTES-B20 NOTES-B27 the tags, types and templates routes answer what the pickers need', async () => {
  await note('Budget note', { tags: ['Budget', 'Risk'] });
  await note('Risk note', { tags: ['Risk'] });
  const tags = await call(api.tags, 'GET', '/notes/tags');
  expect(tags.status).toBe(200);
  expect(tags.body).toEqual({
    data: [
      { tag: 'Risk', count: 2 },
      { tag: 'Budget', count: 1 },
    ],
  });
  const types = await call(api.types, 'GET', '/notes/types');
  expect(types.status).toBe(200);
  expect(types.body.data.map((type: { id: string }) => type.id)).toEqual([
    'board_meeting',
    'executive_meeting',
    'sector_meeting',
    'one_on_one',
    'personal',
    'other',
  ]);
  expect(types.body.meta).toEqual({ defaultType: null });
  await writeSetting(db(), 'notes.default_type', 'personal', admin.id);
  expect((await call(api.types, 'GET', '/notes/types')).body.meta.defaultType).toBe('personal');
  const templates = await call(api.templates, 'GET', '/notes/templates');
  expect(templates.status).toBe(200);
  expect(templates.body.data.map((template: { id: string }) => template.id)).toEqual([
    'meeting',
    'one_on_one',
  ]);
  for (const template of templates.body.data) {
    expect(template.enabled).toBe(true);
    expect(template.body.en).toContain('## ');
    expect(template.body.ar).toContain('## ');
  }
});
it('NOTES-B17 NOTES-A10 refine and suggest-tags answer 503 ai_unavailable while the capabilities are off', async () => {
  const created = await note('Rough draft', { content: 'Agreed to review the budget.' });
  await writeSetting(db(), 'ai.enabled_capabilities', [], admin.id);
  for (const [handler, action] of [
    [api.refine, 'refine'],
    [api.suggestTags, 'suggest-tags'],
  ] as const) {
    const response = await call(handler, 'POST', `/notes/${created.id}/${action}`, {
      body: { revision: created.revision },
      params: { id: created.id },
    });
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('ai_unavailable');
  }
});
it('NOTES-B15 NOTES-B03 the list filtered by a participant returns that person’s latest five notes, newest first', async () => {
  const participant = await person('Reem Participant');
  const today = await workspaceToday();
  const ids: string[] = [];
  for (let back = 0; back < 6; back += 1)
    ids.push(
      (
        await note(`Meeting ${back}`, {
          noteDate: addDays(today, -back),
          participantIds: [participant.id],
        })
      ).id,
    );
  await note('Not theirs', { noteDate: today });
  const theirs = await list(`?view=all&personId=${participant.id}&limit=5`);
  expect(theirs.status).toBe(200);
  const parsed = NoteList.parse(theirs.body);
  expect(parsed.data.map((row) => row.id)).toEqual(ids.slice(0, 5));
  expect(parsed.data.every((row) => row.participants[0]?.id === participant.id)).toBe(true);
  expect(parsed.meta.counts.all).toBe(6);
  expect(parsed.meta.nextCursor).not.toBeNull();
  expect((await list('?view=all')).body.meta.total).toBe(7);
});
it('NOTES-B21 ADMIN-B28 tag administration answers 403 to a member and lists usage to an administrator', async () => {
  await note('Tagged', { tags: ['Old'] });
  session.user = member;
  const refused = await call(api.managedTags, 'GET', '/admin/notes/tags');
  expect(refused.status).toBe(403);
  expect(refused.body.error).toMatchObject({ code: 'forbidden', details: { reason: 'role' } });
  const refusedWrite = await call(api.manageTagSelection, 'POST', '/admin/notes/tags', {
    body: { tags: ['Old'], target: null },
  });
  expect(refusedWrite.status).toBe(403);
  session.user = admin;
  const listed = await call(api.managedTags, 'GET', '/admin/notes/tags');
  expect(listed.status).toBe(200);
  expect(listed.body).toEqual({ data: [{ tag: 'Old', count: 1 }] });
  const renamed = await call(api.manageTagSelection, 'POST', '/admin/notes/tags', {
    body: { tags: ['old'], target: 'New' },
  });
  expect(renamed.status).toBe(200);
  expect(renamed.body).toEqual({ data: { updatedCount: 1 } });
});
