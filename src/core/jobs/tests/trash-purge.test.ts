import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDatabase, db, withTransaction, type Database } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { clearDatabase } from '@/core/db/reset';
import { insertUser } from '@/core/db/auth-repo';
import { writeSetting } from '@/core/db/settings-repo';
import { purgeTrash } from '@/core/db/trash-repo';
import { User } from '@/core/http/user-schema';
import { id } from '@/core/db/ids';
import { createTask, getTask, removeTask } from '@/modules/tasks/service';
import { TaskCreate } from '@/modules/tasks/schema/validation';
import { createNote, removeNote } from '@/modules/notes/service';
import { NoteCreate } from '@/modules/notes/schema/validation';
import { createCommittee, removeCommittee } from '@/modules/committees/service';
import { CommitteeCreate } from '@/modules/committees/schema/validation';
import { createPerson, removePerson } from '@/modules/people';
import { PersonCreate } from '@/modules/people/schema/validation';
import { handlerFor } from '../registry';
let user: User;
const run = <T>(action: (ctx: { db: Database; user: User; requestId: string }) => Promise<T>) =>
  withTransaction(db(), (database) => action({ db: database, user, requestId: id() }));
const person = async (fullName: string) => {
  const created = await run((ctx) =>
    createPerson(
      ctx,
      PersonCreate.parse({
        fullName,
        kind: 'external',
        isAssignable: false,
        tags: [],
        email: null,
        phone: null,
        notes: null,
        displayName: null,
        honorific: null,
        organization: null,
        roleTitle: null,
        userId: null,
      }),
    ),
  );
  if (!created.data) throw new Error('person not created');
  return created.data;
};
const committee = (name: string) =>
  run((ctx) => createCommittee(ctx, CommitteeCreate.parse({ name })));
const ids = async (table: 'tasks' | 'notes' | 'committees' | 'people' | 'note_people') =>
  (await db().all<{ id: string }>(sql`select id from ${sql.identifier(table)}`)).map((r) => r.id);
// Every row in the trash now was trashed 40 days ago, unless it is named here.
const age = (except: string[] = []) =>
  Promise.all(
    ['tasks', 'notes', 'committees', 'people', 'note_people'].map((table) =>
      db().run(
        sql`update ${sql.identifier(table)} set deleted_at = ${Date.now() - 40 * 86400000}
          where deleted_at is not null and id not in (${sql.join(
            [...except, ''].map((value) => sql`${value}`),
            sql`, `,
          )})`,
      ),
    ),
  );
const purge = () =>
  withTransaction(db(), (database) => purgeTrash(database, new Date(Date.now() - 30 * 86400000)));
beforeAll(() => migrateDatabase());
beforeEach(async () => {
  await clearDatabase();
  user = User.parse(
    await insertUser(db(), {
      id: id(),
      name: 'Purger',
      email: 'p@example.test',
      passwordHash: 'x',
      role: 'admin',
    }),
  );
});
afterAll(() => closeDatabase());

it('ADMIN-B48 TASKS-B11 trash past the retention goes with its own parts; anything still linked to stays', async () => {
  // A committee a live task still names stays; one nothing names goes.
  const linked = await committee('Still named');
  const alone = await committee('Nobody left');
  const live = await run((ctx) =>
    createTask(ctx, TaskCreate.parse({ title: 'Live work', committeeId: linked.id })),
  );
  await run((ctx) => removeCommittee(ctx, linked.id, linked.revision));
  await run((ctx) => removeCommittee(ctx, alone.id, alone.revision));
  // A trashed note listing a trashed person: the note goes first, then the person, in one run.
  const listed = await person('Listed Person');
  const note = await run((ctx) =>
    createNote(ctx, NoteCreate.parse({ title: 'Old minutes', participantIds: [listed.id] })),
  );
  await run((ctx) => removeNote(ctx, note.id, note.revision));
  await run((ctx) => removePerson(ctx, listed.id, listed.revision));
  // A trashed parent and its subtask go together; a task trashed yesterday stays.
  const parent = await run((ctx) => createTask(ctx, TaskCreate.parse({ title: 'Parent' })));
  await run((ctx) => createTask(ctx, TaskCreate.parse({ title: 'Child', parentId: parent.id })));
  const fresh = await run((ctx) => createTask(ctx, TaskCreate.parse({ title: 'Yesterday' })));
  const parentNow = await run((ctx) => getTask(ctx, parent.id));
  await run((ctx) => removeTask(ctx, parent.id, parentNow.revision));
  await run((ctx) => removeTask(ctx, fresh.id, fresh.revision));
  await age([fresh.id]);
  const removed = await purge();
  expect(await ids('committees')).toEqual([linked.id]);
  expect(await ids('notes')).toEqual([]);
  expect(await ids('note_people')).toEqual([]);
  expect(await ids('people')).toEqual([]);
  expect((await ids('tasks')).sort()).toEqual([live.id, fresh.id].sort());
  expect(removed).toMatchObject({ committees: 1, notes: 1, people: 1, tasks: 2 });
  // The live task was not touched: it still names its committee.
  const [row] = await db().all<{ committee_id: string | null }>(
    sql`select committee_id from tasks where id = ${live.id}`,
  );
  expect(row?.committee_id).toBe(linked.id);
});

it('ADMIN-B48 a retention of 0 days never purges', async () => {
  const gone = await committee('Old');
  await run((ctx) => removeCommittee(ctx, gone.id, gone.revision));
  await age();
  await writeSetting(db(), 'retention.trash_days', 0, user.id);
  // cast: the publish step reads nothing from the job row.
  await withTransaction(db(), (database) =>
    handlerFor('system.trash_purge').publish(database, {} as never, null),
  );
  expect(await ids('committees')).toEqual([gone.id]);
  await writeSetting(db(), 'retention.trash_days', 30, user.id);
  await withTransaction(db(), (database) =>
    handlerFor('system.trash_purge').publish(database, {} as never, null),
  );
  expect(await ids('committees')).toEqual([]);
});
