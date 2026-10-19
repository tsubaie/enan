import { createHarness } from '@/core/db/test-harness';
import { db } from '@/core/db/client';
import { getSetting } from '@/core/db/settings-repo';
import { dayAt } from '@/core/time/tasks';
import { createPerson } from '@/modules/people';
import { PersonCreate, personDraft } from '@/modules/people/schema/validation';
import { createNote } from '@/modules/notes/service';
import { NoteCreate } from '@/modules/notes/schema/validation';
import { createCommittee } from '@/modules/committees/service';
import { CommitteeCreate } from '@/modules/committees/schema/validation';
import { TaskCreate } from '../schema/validation';
import * as service from '../service';
// Shared harness for the task scenarios: a clean database, one admin actor, and factories that go
// through the services so every row carries provenance and every invariant is exercised. The
// neighbours a task links to (an assignable person, a note, a committee) are created the same way.
const base = createHarness({ name: 'Task Tester', email: 'tasks@example.test' });
export const harness = {
  get user() {
    return base.user;
  },
  run: base.run,
  reset: base.reset,
  task(title: string, fields: Partial<TaskCreate> = {}) {
    return harness.run((ctx) => service.createTask(ctx, TaskCreate.parse({ title, ...fields })));
  },
  async person(fullName: string, fields: Partial<PersonCreate> = {}) {
    const created = await harness.run((ctx) =>
      createPerson(
        ctx,
        PersonCreate.parse({ ...personDraft(fullName), isAssignable: true, ...fields }),
      ),
    );
    if (!created.data) throw new Error('person not created');
    return created.data;
  },
  note(title: string, fields: Partial<NoteCreate> = {}) {
    return harness.run((ctx) => createNote(ctx, NoteCreate.parse({ title, ...fields })));
  },
  committee(name: string, fields: Partial<CommitteeCreate> = {}) {
    return harness.run((ctx) => createCommittee(ctx, CommitteeCreate.parse({ name, ...fields })));
  },
};
export async function workspaceToday() {
  return dayAt(await getSetting(db(), 'workspace.timezone'));
}
