import { expect, it } from 'vitest';
import { UserCreate, UserPatch } from '../schema/validation';
import { Recovery, Setup } from '@/core/auth/validation';
import { midnightBoundaries } from '../../../../tests/fixtures/timezones';
const zone = midnightBoundaries[0]?.timezone ?? 'UTC';
const issues = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  (result.error?.issues ?? []).map((issue) => issue.path.join('.'));
it('ADMIN-B03 an invitation carries a name, a lower-cased email and a role, and nothing else', () => {
  const parsed = UserCreate.parse({
    name: '  Dana Example  ',
    email: 'Dana@Example.TEST',
    role: 'member',
  });
  expect(parsed).toEqual({ name: 'Dana Example', email: 'dana@example.test', role: 'member' });
  const invalid = UserCreate.safeParse({ name: '  ', email: 'not-an-email', role: 'owner' });
  expect(invalid.success).toBe(false);
  expect(issues(invalid)).toEqual(expect.arrayContaining(['name', 'email', 'role']));
  // The server generates the first password (ADMIN-B03), so an invitation cannot carry one.
  expect(
    UserCreate.safeParse({
      name: 'D',
      email: 'd@x.test',
      role: 'admin',
      password: 'a password long enough',
    }),
  ).toMatchObject({ success: false });
  expect(
    UserCreate.safeParse({ name: 'D', email: 'd@x.test', role: 'admin', isActive: false }).success,
  ).toBe(false);
});
it('ADMIN-B03 an edit replaces name, role and activity against the revision it was read at', () => {
  expect(UserPatch.parse({ name: 'Dana', role: 'admin', isActive: false, revision: 3 })).toEqual({
    name: 'Dana',
    role: 'admin',
    isActive: false,
    revision: 3,
  });
  for (const revision of [0, -1, 1.5, '2'])
    expect(
      UserPatch.safeParse({ name: 'Dana', role: 'admin', isActive: true, revision }).success,
    ).toBe(false);
  const partial = UserPatch.safeParse({ name: 'Dana', revision: 1 });
  expect(partial.success).toBe(false);
  expect(issues(partial)).toEqual(expect.arrayContaining(['role', 'isActive']));
  expect(
    UserPatch.safeParse({
      name: 'D',
      role: 'member',
      isActive: true,
      revision: 1,
      email: 'x@y.test',
    }).success,
  ).toBe(false);
});
it('ADMIN-B02 a recovery submission names the administrator, a new password and the token', () => {
  const parsed = Recovery.parse({
    email: 'Admin@Example.TEST',
    password: 'a-brand-new-password-1',
    token: 'recovery-token',
  });
  expect(parsed.email).toBe('admin@example.test');
  const weak = Recovery.safeParse({ email: 'a@b.test', password: 'short', token: 't' });
  expect(issues(weak)).toEqual(['password']);
  const missing = Recovery.safeParse({ email: 'a@b.test', password: 'a-brand-new-password-1' });
  expect(issues(missing)).toEqual(['token']);
  expect(
    Recovery.safeParse({ email: 'a@b.test', password: 'a-brand-new-password-1', token: '' })
      .success,
  ).toBe(false);
});
it('ADMIN-B01 setup refuses an unknown timezone and defaults the principal to the administrator', () => {
  const base = {
    email: 'admin@example.test',
    password: 'a-brand-new-password-1',
    setupToken: 'token',
    name: 'Admin',
    workspaceName: 'Office',
    locale: 'en',
  };
  expect(Setup.parse({ ...base, timezone: zone }).principalName).toBe('');
  expect(issues(Setup.safeParse({ ...base, timezone: 'Mars/Olympus' }))).toEqual(['timezone']);
  expect(issues(Setup.safeParse({ ...base, timezone: 'UTC', locale: 'fr' }))).toEqual(['locale']);
});
