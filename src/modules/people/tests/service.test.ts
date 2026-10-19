import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
import { closeDatabase, db, withTransaction, type Database } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { clearDatabase } from '@/core/db/reset';
import { insertUser } from '@/core/db/auth-repo';
import { User } from '@/core/http/user-schema';
import { id } from '@/core/db/ids';
import { PersonCreate, PersonListQuery } from '../schema/validation';
import { createPerson, listPeople } from '../service';
import { seedPeople } from '../../../../tests/fixtures/people';
let user: User;
const run = <T>(action: (ctx: { db: Database; user: User; requestId: string }) => Promise<T>) =>
  withTransaction(db(), (database) => action({ db: database, user, requestId: id() }));
const blanks = {
  displayName: null,
  honorific: null,
  email: null,
  phone: null,
  notes: null,
  tags: [],
  userId: null,
};
beforeAll(async () => {
  await migrateDatabase();
});
beforeEach(async () => {
  await clearDatabase();
  user = User.parse(
    await insertUser(db(), {
      id: id(),
      name: 'People Tester',
      email: 'p@example.test',
      passwordHash: 'x',
      role: 'admin',
    }),
  );
});
afterAll(() => closeDatabase());
it('PEOPLE-B08 meta.total is present only when the request asks for it', async () => {
  for (const person of seedPeople.slice(0, 2))
    await run((ctx) => createPerson(ctx, PersonCreate.parse({ ...person, ...blanks })));
  const query = (withTotal?: 'true' | 'false') =>
    run((ctx) =>
      listPeople(ctx, PersonListQuery.parse({ view: 'all', ...(withTotal && { withTotal }) })),
    );
  const asked = await query('true');
  expect(asked.meta.total).toBe(2);
  expect(asked.meta.counts.all).toBe(2);
  expect((await query('false')).meta).not.toHaveProperty('total');
  const omitted = await query();
  expect(omitted.meta).not.toHaveProperty('total');
  expect(omitted.meta.counts.all).toBe(2);
});
it('PEOPLE-B02 SEARCH-B01 SEARCH-B03 the tag facet, the list search and the provider read the JSON tags and the written corpus', async () => {
  const { searchProvider } = await import('../search');
  const { patchPerson } = await import('../service');
  const { normalize } = await import('@/core/search/normalize');
  const person = (fields: object) =>
    run((ctx) => createPerson(ctx, PersonCreate.parse({ ...seedPeople[0], ...blanks, ...fields })));
  const board = await person({ fullName: 'Leila Haddad', tags: ['Board', 'Finance'] });
  const finance = await person({ fullName: 'Omar Nasser', tags: ['Finance'], organization: null });
  await person({ fullName: 'Maya Faris', tags: [], organization: 'Northbridge Studio' });
  const list = (query: object) =>
    run((ctx) => listPeople(ctx, PersonListQuery.parse({ view: 'all', ...query })));
  expect((await list({ tag: 'Board' })).data.map((row) => row.fullName)).toEqual(['Leila Haddad']);
  expect((await list({ tag: 'Finance' })).meta.counts.all).toBe(2);
  expect((await list({ tag: 'Boar' })).data).toEqual([]);
  // The organization is part of the corpus, and an update rewrites it.
  expect((await list({ q: 'cedar' })).data.map((row) => row.fullName)).toEqual(['Leila Haddad']);
  await run((ctx) =>
    patchPerson(ctx, finance.data!.id, { revision: 1, organization: 'Cedar Advisory' }),
  );
  expect((await list({ q: 'cedar' })).data.map((row) => row.fullName)).toEqual([
    'Leila Haddad',
    'Omar Nasser',
  ]);
  // The provider ranks a full-name prefix before a match elsewhere in the record.
  const hits = await run((ctx) => searchProvider(ctx, normalize('ha'), 5));
  expect(hits.map((hit) => [hit.title, hit.rank])).toEqual([['Leila Haddad', 1]]);
  const prefix = await run((ctx) => searchProvider(ctx, normalize('omar'), 5));
  expect(prefix.map((hit) => [hit.title, hit.rank])).toEqual([['Omar Nasser', 0]]);
  expect(board.data?.tags).toEqual(['Board', 'Finance']);
});
const draft = (fullName: string, fields: object = {}) =>
  PersonCreate.parse({ ...seedPeople[0], fullName, ...blanks, ...fields });
const person = async (fullName: string, fields: object = {}) => {
  const created = await run((ctx) => createPerson(ctx, draft(fullName, fields)));
  if (!created.data) throw new Error(`person "${fullName}" reported as a duplicate`);
  return created.data;
};
async function member() {
  return User.parse(
    await insertUser(db(), {
      id: id(),
      name: 'Plain Member',
      email: `member-${id()}@example.test`,
      passwordHash: 'x',
      role: 'member',
    }),
  );
}
const runAs = <T>(
  actor: User,
  action: (ctx: { db: Database; user: User; requestId: string }) => Promise<T>,
) => withTransaction(db(), (database) => action({ db: database, user: actor, requestId: id() }));
it('PEOPLE-I01 a homonym is reported instead of created until the create is confirmed', async () => {
  const leila = await person('Leila Haddad');
  const refused = await run((ctx) => createPerson(ctx, draft('leila haddad')));
  expect(refused.data).toBeNull();
  expect(refused.meta.possibleDuplicates.map((row) => row.id)).toEqual([leila.id]);
  const confirmed = await run((ctx) =>
    createPerson(ctx, draft('leila haddad', { confirmDuplicate: true })),
  );
  expect(confirmed.data?.id).toEqual(expect.any(String));
  expect(confirmed.data?.id).not.toBe(leila.id);
  expect(confirmed.meta.possibleDuplicates).toEqual([]);
  // A deleted homonym no longer stands in the way.
  const { removePerson } = await import('../service');
  await run((ctx) => removePerson(ctx, leila.id, leila.revision));
  const third = confirmed.data;
  if (third) await run((ctx) => removePerson(ctx, third.id, third.revision));
  const free = await run((ctx) => createPerson(ctx, draft('Leila Haddad')));
  expect(free.data?.fullName).toBe('Leila Haddad');
});
it('PEOPLE-I02 only an administrator links a person to a member, and each member links to one person', async () => {
  const { patchPerson } = await import('../service');
  const plain = await member();
  await expect(
    runAs(plain, (ctx) => createPerson(ctx, draft('Linked by member', { userId: plain.id }))),
  ).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'role' } });
  const target = await person('Target');
  await expect(
    runAs(plain, (ctx) => patchPerson(ctx, target.id, { revision: 1, userId: plain.id })),
  ).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'role' } });
  // A member's patch that says nothing about the link is an ordinary edit.
  const edited = await runAs(plain, (ctx) =>
    patchPerson(ctx, target.id, { revision: 1, roleTitle: 'Adviser' }),
  );
  expect(edited.roleTitle).toBe('Adviser');
  const linked = await person('Linked', { userId: plain.id });
  expect(linked.userId).toBe(plain.id);
  await expect(
    run((ctx) => createPerson(ctx, draft('Linked twice', { userId: plain.id }))),
  ).rejects.toMatchObject({
    code: 'conflict',
    details: { reason: 'state' },
  });
  await expect(
    run((ctx) => patchPerson(ctx, target.id, { revision: edited.revision, userId: plain.id })),
  ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'state' } });
  // Unlinking frees the member for the other person.
  await run((ctx) => patchPerson(ctx, linked.id, { revision: linked.revision, userId: null }));
  const moved = await run((ctx) =>
    patchPerson(ctx, target.id, { revision: edited.revision, userId: plain.id }),
  );
  expect(moved.userId).toBe(plain.id);
});
it('PEOPLE-I03 TASKS-B10 switching assignability off hides the person from owner pickers but keeps the tasks they own', async () => {
  const { assignablePeople, patchPerson } = await import('../service');
  const { createTask, getTask } = await import('@/modules/tasks/service');
  const { TaskCreate } = await import('@/modules/tasks/schema/validation');
  const owner = await person('Owner', { isAssignable: true });
  await person('Bystander', { isAssignable: false });
  expect((await run((ctx) => assignablePeople(ctx))).map((row) => row.id)).toEqual([owner.id]);
  const task = await run((ctx) =>
    createTask(ctx, TaskCreate.parse({ title: 'Held', ownerId: owner.id })),
  );
  await run((ctx) => patchPerson(ctx, owner.id, { revision: owner.revision, isAssignable: false }));
  expect(await run((ctx) => assignablePeople(ctx))).toEqual([]);
  expect((await run((ctx) => getTask(ctx, task.id))).ownerId).toBe(owner.id);
  await expect(
    run((ctx) => createTask(ctx, TaskCreate.parse({ title: 'New', ownerId: owner.id }))),
  ).rejects.toMatchObject({ code: 'rule_violation', details: { rule: 'TASKS-B10' } });
});
it('PEOPLE-I04 the principal cannot be deleted', async () => {
  const { removePerson } = await import('../service');
  const { writeSetting } = await import('@/core/db/settings-repo');
  const principal = await person('Principal');
  const other = await person('Other');
  await writeSetting(db(), 'workspace.principal_person_id', principal.id, user.id);
  await expect(
    run((ctx) => removePerson(ctx, principal.id, principal.revision)),
  ).rejects.toMatchObject({
    code: 'rule_violation',
    details: { rule: 'PEOPLE-I04' },
  });
  expect(
    (await run((ctx) => listPeople(ctx, PersonListQuery.parse({ view: 'all' })))).meta.counts.all,
  ).toBe(2);
  await expect(run((ctx) => removePerson(ctx, other.id, other.revision))).resolves.toMatchObject({
    opId: expect.any(String),
  });
});
it('PEOPLE-I05 PEOPLE-B07 deleting a person keeps their tasks and the op id alone restores them', async () => {
  const { removePerson, restorePerson, getPerson } = await import('../service');
  const { createTask, getTask } = await import('@/modules/tasks/service');
  const { TaskCreate } = await import('@/modules/tasks/schema/validation');
  const owner = await person('Owner', { isAssignable: true });
  const task = await run((ctx) =>
    createTask(ctx, TaskCreate.parse({ title: 'Kept', ownerId: owner.id })),
  );
  await expect(run((ctx) => removePerson(ctx, owner.id, 9))).rejects.toMatchObject({
    code: 'conflict',
    details: { reason: 'revision' },
  });
  const { opId } = await run((ctx) => removePerson(ctx, owner.id, owner.revision));
  const held = await run((ctx) => getTask(ctx, task.id));
  expect(held.ownerId).toBe(owner.id);
  await expect(run((ctx) => getPerson(ctx, owner.id))).rejects.toMatchObject({ code: 'not_found' });
  const trashed = await run((ctx) => getPerson(ctx, owner.id, true));
  expect(trashed.deletedOpId).toBe(opId);
  const views = (await run((ctx) => listPeople(ctx, PersonListQuery.parse({ view: 'trash' }))))
    .data;
  expect(views.map((row) => row.id)).toEqual([owner.id]);
  await expect(run((ctx) => restorePerson(ctx, owner.id, id()))).rejects.toMatchObject({
    code: 'conflict',
    details: { reason: 'state' },
  });
  const restored = await run((ctx) => restorePerson(ctx, owner.id, opId));
  expect(restored).toMatchObject({ id: owner.id, deletedAt: null, deletedOpId: null });
  expect(restored.revision).toBeGreaterThan(owner.revision);
});
it('NOTES-B15 the notes module lists the notes a person took part in, latest first, for the person page', async () => {
  const { listNotes, createNote } = await import('@/modules/notes/service');
  const { NoteCreate, NoteListQuery } = await import('@/modules/notes/schema/validation');
  const guest = await person('Guest');
  const other = await person('Other');
  for (let day = 1; day <= 6; day += 1)
    await run((ctx) =>
      createNote(
        ctx,
        NoteCreate.parse({
          title: `Note ${day}`,
          noteDate: `2026-03-0${day}`,
          participantIds: [guest.id],
        }),
      ),
    );
  await run((ctx) =>
    createNote(
      ctx,
      NoteCreate.parse({ title: 'Elsewhere', noteDate: '2026-03-09', participantIds: [other.id] }),
    ),
  );
  const listed = await run((ctx) => listNotes(ctx, NoteListQuery.parse({ personId: guest.id })));
  expect(listed.data.map((note) => note.title)).toEqual([
    'Note 6',
    'Note 5',
    'Note 4',
    'Note 3',
    'Note 2',
    'Note 1',
  ]);
  expect(listed.meta.counts.all).toBe(6);
  expect(
    (await run((ctx) => listNotes(ctx, NoteListQuery.parse({ personId: other.id })))).data,
  ).toHaveLength(1);
});
