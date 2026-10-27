import type { Account } from '../../schema/validation';
// One reader's account as the page receives it, with a second device signed in. Scenarios override
// what they are about and leave the rest.
export const current = {
  id: '01a08a9f-1991-760a-b73a-568f6f866501',
  current: true,
  issuedAt: '2026-09-10T07:00:00.000Z',
  lastSeenAt: '2026-09-10T08:30:00.000Z',
  ip: '203.0.113.7',
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0',
};
export const other = {
  id: '01a08a9f-1991-760a-b73a-568f6f866502',
  current: false,
  issuedAt: '2026-09-01T07:00:00.000Z',
  lastSeenAt: '2026-09-09T19:00:00.000Z',
  ip: '198.51.100.4',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/605.1',
};
export const person = {
  id: '01a08a9f-1991-760a-b73a-568f6f866510',
  fullName: 'Leila Haddad',
  organization: 'Cedar Advisory',
  roleTitle: 'Chief of staff',
};
export const account = (overrides: Partial<Account> = {}): Account => ({
  user: {
    id: '01a08a9f-1991-760a-b73a-568f6f866500',
    name: 'Leila Haddad',
    email: 'leila@example.test',
    role: 'member',
    revision: 3,
    passwordChangedAt: null,
  },
  person,
  preferences: { locale: 'en', timezone: 'UTC', theme: 'dark', numerals: 'western', explicit: [] },
  sessions: [current, other],
  signInMethods: ['password'],
  passkeys: [],
  ...overrides,
});
export function mutation() {
  return {
    mutate: vi.fn(),
    isPending: false,
    isSuccess: false,
    error: null as Error | null,
    data: undefined as { data: { revoked: number } } | undefined,
  };
}
export type Mutation = ReturnType<typeof mutation>;
import { vi } from 'vitest';
