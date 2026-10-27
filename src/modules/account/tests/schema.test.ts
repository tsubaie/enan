import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { midnightBoundaries } from '../../../../tests/fixtures/timezones';
// A real IANA zone from the shared fixtures (audit:portability forbids literals in modules).
const zone = midnightBoundaries[0]?.timezone ?? 'UTC';
import {
  Account,
  AccountPatch,
  AccountPreferences,
  EmailChange,
  Numerals,
  PasswordChange,
} from '../schema/validation';
// Field paths as the handler reports them: every issue's path joined with dots.
const paths = (schema: z.ZodType, value: object) => {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};
describe('ACCT-B01 ACCT-B06 the name is a field and the address is a form of its own', () => {
  it('ACCT-B01 trims the name and refuses an empty or oversized one', () => {
    expect(AccountPatch.parse({ revision: 1, name: '  Reader  ' }).name).toBe('Reader');
    expect(paths(AccountPatch, { revision: 1, name: '   ' })).toEqual(['name']);
    expect(paths(AccountPatch, { revision: 1, name: 'x'.repeat(201) })).toEqual(['name']);
  });
  it('ACCT-B01 lowercases the address, refuses a malformed or oversized one, and needs the revision and current password', () => {
    expect(
      EmailChange.parse({ revision: 3, email: 'Reader@Example.TEST', current: 'pw' }).email,
    ).toBe('reader@example.test');
    expect(paths(EmailChange, { revision: 3, email: 'not-an-address', current: 'pw' })).toEqual([
      'email',
    ]);
    expect(
      paths(EmailChange, { revision: 3, email: `${'a'.repeat(320)}@example.test`, current: 'pw' }),
    ).toEqual(['email']);
    expect(paths(EmailChange, { email: 'reader@example.test', current: 'pw' })).toEqual([
      'revision',
    ]);
    expect(
      paths(EmailChange, { revision: 0, email: 'reader@example.test', current: 'pw' }),
    ).toEqual(['revision']);
    expect(paths(EmailChange, { revision: 3, email: 'reader@example.test' })).toEqual(['current']);
  });
});
describe('ACCT-B02 a password change names the current password and a new one the registration rules accept', () => {
  it('ACCT-B02 requires the current password and twelve characters for the next', () => {
    expect(
      PasswordChange.parse({ current: 'old password here', next: 'a brand new password' }),
    ).toEqual({ current: 'old password here', next: 'a brand new password' });
    expect(paths(PasswordChange, { current: '', next: 'a brand new password' })).toEqual([
      'current',
    ]);
    expect(paths(PasswordChange, { current: 'old password here', next: 'elevenchars' })).toEqual([
      'next',
    ]);
    expect(paths(PasswordChange, { current: 'x'.repeat(257), next: 'x'.repeat(257) })).toEqual([
      'current',
      'next',
    ]);
  });
  it('ACCT-B02 carries nothing but the two passwords', () => {
    expect(
      PasswordChange.safeParse({
        current: 'old password here',
        next: 'a brand new password',
        revision: 1,
      }).success,
    ).toBe(false);
  });
});
describe('ACCT-B04 ACCT-I03 each preference is its own value or the empty string that means "follow the workspace"', () => {
  it.each(['locale', 'timezone', 'theme', 'numerals'] as const)(
    'ACCT-B04 ACCT-I03 %s accepts "" and refuses a value outside its own set',
    (name) => {
      expect(AccountPatch.parse({ revision: 1, [name]: '' })[name]).toBe('');
      expect(paths(AccountPatch, { revision: 1, [name]: 'made-up' })).toEqual([name]);
      expect(AccountPatch.parse({ revision: 1 })[name]).toBeUndefined();
    },
  );
  it('ACCT-B04 takes exactly the values the header toggles and the registry write', () => {
    expect(AccountPatch.parse({ revision: 1, locale: 'ar', theme: 'light' })).toMatchObject({
      locale: 'ar',
      theme: 'light',
    });
    expect(AccountPatch.parse({ revision: 1, numerals: 'arabic', timezone: zone })).toMatchObject({
      numerals: 'arabic',
      timezone: zone,
    });
    expect(Numerals.options).toEqual(['western', 'arabic']);
    expect(paths(AccountPatch, { revision: 1, timezone: 'Mars/Olympus_Mons' })).toEqual([
      'timezone',
    ]);
  });
  it('ACCT-B04 the response says which preferences the reader set explicitly, out of the four', () => {
    const preferences = AccountPreferences.parse({
      locale: 'en',
      timezone: 'UTC',
      theme: 'dark',
      numerals: 'western',
      explicit: ['theme'],
    });
    expect(preferences.explicit).toEqual(['theme']);
    expect(
      AccountPreferences.safeParse({
        locale: 'en',
        timezone: 'UTC',
        theme: 'dark',
        numerals: 'western',
        explicit: ['avatar'],
      }).success,
    ).toBe(false);
  });
});
describe('ACCT-I01 ACCT-I02 the patch has no way to name another account or an administrative field', () => {
  it('ACCT-I01 refuses any user identifier in the body', () => {
    for (const key of ['id', 'userId', 'user_id', 'email'])
      expect(AccountPatch.safeParse({ revision: 1, [key]: 'anything' }).success).toBe(false);
  });
  it('ACCT-I02 ACCT-B07 refuses role, active state and deletion markers', () => {
    for (const key of ['role', 'isActive', 'is_active', 'deletedAt'])
      expect(AccountPatch.safeParse({ revision: 1, [key]: 'anything' }).success).toBe(false);
    expect(paths(AccountPatch, { name: 'Reader' })).toEqual(['revision']);
  });
  it('ACCT-I02 the account response states the role as read-only fact and never the password', () => {
    // Whatever the row carries, the response schema lets only the listed fields through.
    const account = Account.parse({
      user: {
        id: '01a08a9f-1991-760a-b73a-568f6f866500',
        name: 'Reader',
        email: 'reader@example.test',
        role: 'member',
        revision: 1,
        passwordChangedAt: null,
        passwordHash: '$argon2id$leaked',
        isActive: true,
      },
      person: null,
      preferences: {
        locale: 'en',
        timezone: 'UTC',
        theme: 'dark',
        numerals: 'western',
        explicit: [],
      },
      sessions: [],
      signInMethods: ['password'],
      passkeys: [],
    });
    expect(account.user).not.toHaveProperty('passwordHash');
    expect(account.user).not.toHaveProperty('isActive');
  });
});
