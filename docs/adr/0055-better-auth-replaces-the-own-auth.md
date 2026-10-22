# ADR 0055 — Better Auth replaces the own auth

**Status:** accepted (2026-10-23); supersedes ADR 0005 (sessions, cookie, login) and the decision of ADR 0053 to extend the own auth. ADR 0053's sealed credentials and its SMTP transport stand; ADR 0013's address resolution and throttling buckets stand and now ride on Better Auth's hooks.

## Context

Issue #47 decided to adopt [Better Auth](https://www.better-auth.com/) for sign-in: Google, one-time codes by email, and the existing email and password, in the install's own SQLite database through the Drizzle adapter. ADR 0053 instead extended the hand-written auth of ADR 0005, because Better Auth stores session tokens as they are rather than hashed. That was a hardening preference, not a reason to depart from the issue, and the maintainer did not choose it. Most applications on Better Auth, and most session libraries, store the token as is; a copy of the database already holds every record the session would reach.

## Decision

- **Better Auth owns sign-in, sessions and cookies**, mounted at `/api/auth/*`: email and password, the `emailOTP` plugin (six digits, ten minutes, five attempts, stored hashed), Google (`/api/auth/callback/google`), sign-out. The session is a row in `auth_sessions`; the cookie is `enan.session_token` (`__Secure-` in production), signed with `SESSION_SECRET`, sliding 30 days and refreshed at most daily.
- **Its tables are its own** (`auth_sessions`, `auth_accounts`, `auth_verifications`, in `core/db/auth-schema.ts`); the user is Enan's `users` row, with `email_verified` and `image` added. OAuth tokens are encrypted at rest; verification identifiers are hashed.
- **Nobody signs themselves up.** Sign-up is off for passwords, codes and Google; only accounts an administrator made can sign in, Google matched on its verified email and linked to the existing account.
- **Enan's rules ride on Better Auth's hooks**: the workspace's chosen methods (ADMIN-B64), the independent email and address buckets of ADR 0013 for passwords and codes, the send throttle for codes (ADMIN-B63), the `X-Requested-With` header on every state-changing call, and refusing a session to a deactivated or deleted account. Better Auth's own rate limiter is off, because it keys by address alone; endpoints Enan does not use are disabled.
- **Enan's own pieces stay Enan's**: first-run setup (which then signs in through Better Auth), the recovery token, last-admin protection, and the session lists and revocation on the account and admin pages, which read and delete `auth_sessions` rows.
- **Passwords carry over unchanged.** Better Auth hashes with Enan's argon2id, and migration 0012 copies every `users.password_hash` into a credential account, so nobody resets a password. Existing sessions are not carried over; everyone signs in once more.

## Consequences

- `users.password_hash` is kept and written alongside `auth_accounts.password` so the previous release can still sign in on a migrated database (ADR 0050). The old `sessions` table, the code columns of `sign_in_codes` and `users.google_subject` are no longer written; a later contract migration drops them.
- A copy of the database holds live session tokens until they expire. Backups already hold every record those sessions reach, and keeping `SESSION_SECRET` and backups protected is the control, as before.
- The absolute 90-day session cap of ADR 0005 is gone: an active session slides indefinitely, as Better Auth's sessions do. Deactivation and password changes still end sessions.
- Upgrading Better Auth is a dependency upgrade like any other; the hooks and options are covered by `core/auth/tests/better-auth.test.ts`.
