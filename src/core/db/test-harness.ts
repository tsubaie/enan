import 'server-only';
import { db, withTransaction, type Database } from './client';
import { clearDatabase } from './reset';
import { insertUser } from './auth-repo';
import { id } from './ids';
import { User } from '@/core/http/user-schema';
export type HarnessContext = { db: Database; user: User; requestId: string };
// Test support shared by the module fixtures: a clean database and one admin actor, with every
// scenario run inside its own immediate transaction so the services see the shape a request has.
export function createHarness(actor: { name: string; email: string }) {
  const harness = {
    user: null as User | null, // cast: the actor is set by reset() before any scenario runs
    run<T>(action: (ctx: HarnessContext) => Promise<T>) {
      const user = harness.user;
      if (!user) throw new Error('reset the harness before running a scenario');
      return withTransaction(db(), (database) => action({ db: database, user, requestId: id() }));
    },
    async reset() {
      await clearDatabase();
      harness.user = User.parse(
        await insertUser(db(), {
          id: id(),
          name: actor.name,
          email: actor.email,
          passwordHash: 'unused-test-hash',
          role: 'admin',
        }),
      );
    },
  };
  return harness;
}
