import { createHarness } from '@/core/db/test-harness';
import { createPerson } from '@/modules/people';
import { PersonCreate, personDraft } from '@/modules/people/schema/validation';
import { createTask } from '@/modules/tasks/service';
import { TaskCreate } from '@/modules/tasks/schema/validation';
import { NoteCreate } from '../schema/validation';
import * as service from '../service';
// Shared harness for the notes scenarios: a clean database, one admin actor, factories through
// the services so every row carries provenance.
const base = createHarness({ name: 'Notes Tester', email: 'notes@example.test' });
export const harness = {
  get user() {
    return base.user;
  },
  run: base.run,
  reset: base.reset,
  note(title: string, fields: Partial<NoteCreate> = {}) {
    return harness.run((ctx) => service.createNote(ctx, NoteCreate.parse({ title, ...fields })));
  },
  async person(fullName: string, fields: Partial<PersonCreate> = {}) {
    const created = await harness.run((ctx) =>
      createPerson(ctx, PersonCreate.parse({ ...personDraft(fullName), ...fields })),
    );
    if (!created.data) throw new Error('person not created');
    return created.data;
  },
  task(title: string, fields: Partial<TaskCreate> = {}) {
    return harness.run((ctx) => createTask(ctx, TaskCreate.parse({ title, ...fields })));
  },
};
export function actorId() {
  if (!harness.user) throw new Error('reset the harness before reading the actor');
  return harness.user.id;
}
