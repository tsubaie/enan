import { createHarness, type HarnessContext } from '@/core/db/test-harness';
import { db, withTransaction } from '@/core/db/client';
import { insertUser } from '@/core/db/auth-repo';
import { id } from '@/core/db/ids';
import { User } from '@/core/http/user-schema';
import { createTask } from '@/modules/tasks/service';
import { TaskCreate } from '@/modules/tasks/schema/validation';
import { PersonCreate, personDraft } from '../schema/validation';
import * as service from '../service';
// Shared harness for the directory scenarios: a clean database, one admin actor, and factories
// that go through the services so every row carries provenance and every invariant is exercised.
const base = createHarness({ name: 'People Tester', email: 'people@example.test' });
export const harness = {
  get user() {
    return base.user;
  },
  run: base.run,
  reset: base.reset,
  // A second account with the given role, for the scenarios where who is asking decides.
  async account(role: 'admin' | 'member') {
    return User.parse(
      await insertUser(db(), {
        id: id(),
        name: `${role} account`,
        email: `${role}-${id()}@example.test`,
        passwordHash: 'unused-test-hash',
        role,
      }),
    );
  },
  runAs<T>(user: User, action: (ctx: HarnessContext) => Promise<T>) {
    return withTransaction(db(), (database) => action({ db: database, user, requestId: id() }));
  },
  async person(fullName: string, fields: Partial<PersonCreate> = {}) {
    const created = await harness.run((ctx) =>
      service.createPerson(ctx, PersonCreate.parse({ ...personDraft(fullName), ...fields })),
    );
    if (!created.data) throw new Error(`person "${fullName}" reported as a duplicate`);
    return created.data;
  },
  task(title: string, fields: Partial<TaskCreate> = {}) {
    return harness.run((ctx) => createTask(ctx, TaskCreate.parse({ title, ...fields })));
  },
};
