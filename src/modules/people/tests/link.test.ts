import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { closeDatabase } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { createUser } from '@/modules/users/service';
import { UserCreate } from '@/modules/users/schema/validation';
import { getPerson, patchPerson } from '../service';
import { harness } from './fixtures';
beforeAll(() => migrateDatabase());
beforeEach(() => harness.reset());
afterAll(() => closeDatabase());
it('PEOPLE-B13 an internal record carrying a login address links to that login, in any case', async () => {
  const member = await harness.account('member');
  const person = await harness.person('Linked Colleague', {
    kind: 'internal',
    email: member.email.toUpperCase(),
  });
  expect(person.userId).toBe(member.id);
  // An external record, or a login already held, is never linked by address.
  const outsider = await harness.person('Outside Contact', { email: member.email });
  expect(outsider.userId).toBeNull();
  const twin = await harness.person('Second Record', { kind: 'internal', email: member.email });
  expect(twin.userId).toBeNull();
});
it('PEOPLE-B13 a record made internal, or given the address later, links on the patch', async () => {
  const member = await harness.account('member');
  const person = await harness.person('Later Colleague', { email: member.email });
  const patched = await harness.run((ctx) =>
    patchPerson(ctx, person.id, { kind: 'internal', revision: person.revision }),
  );
  expect(patched.userId).toBe(member.id);
});
it('PEOPLE-B13 a login created after its directory record finds the one record with its address', async () => {
  const person = await harness.person('Future Colleague', {
    kind: 'internal',
    email: 'future@example.test',
  });
  expect(person.userId).toBeNull();
  const { user } = await harness.run((ctx) =>
    createUser(
      ctx,
      UserCreate.parse({ name: 'Future Colleague', email: 'future@example.test', role: 'member' }),
    ),
  );
  expect((await harness.run((ctx) => getPerson(ctx, person.id))).userId).toBe(user.id);
});
