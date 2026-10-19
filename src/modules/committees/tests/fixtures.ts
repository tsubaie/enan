import { createHarness } from '@/core/db/test-harness';
import { db } from '@/core/db/client';
import { getSetting } from '@/core/db/settings-repo';
import { dayAt } from '@/core/time/tasks';
import { createTask } from '@/modules/tasks/service';
import { TaskCreate } from '@/modules/tasks/schema/validation';
import { createNote } from '@/modules/notes/service';
import { NoteCreate } from '@/modules/notes/schema/validation';
import { CommitteeCreate } from '../schema/validation';
import * as service from '../service';
// Shared harness for the committee scenarios: a clean database, one admin actor, and factories
// that go through the services, including the tasks and notes a committee's figures are read from.
const base = createHarness({ name: 'Committee Tester', email: 'committees@example.test' });
export const harness = {
  get user() {
    return base.user;
  },
  run: base.run,
  reset: base.reset,
  committee(name: string, fields: Partial<CommitteeCreate> = {}) {
    return harness.run((ctx) =>
      service.createCommittee(ctx, CommitteeCreate.parse({ name, ...fields })),
    );
  },
  task(title: string, fields: Partial<TaskCreate> = {}) {
    return harness.run((ctx) => createTask(ctx, TaskCreate.parse({ title, ...fields })));
  },
  note(title: string, fields: Partial<NoteCreate> = {}) {
    return harness.run((ctx) => createNote(ctx, NoteCreate.parse({ title, ...fields })));
  },
};
export async function workspaceToday() {
  return dayAt(await getSetting(db(), 'workspace.timezone'));
}
