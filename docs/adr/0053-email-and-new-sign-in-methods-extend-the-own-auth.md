# ADR 0053 — Email and new sign-in methods extend the own auth; their credentials are sealed in the database

**Status:** accepted (2026-10-23); refines ADR 0005, keeps ADR 0013.

## Context

Issue #47 asks for three things an office needs and Enan cannot do: send email, sign in with a one-time code sent by email, and sign in with Google. It proposed doing so by replacing the hand-written auth of ADR 0005 with Better Auth, while keeping every protection that auth already has: independent email and address throttling, uniform login cost (ADR 0013), the request header on writes, first-run setup, the recovery token, last-admin protection, and session listing and revocation.

Reading Better Auth 1.7 against those protections found two conflicts:

- **Session tokens.** Better Auth stores each session token as is in its `session` table. ADR 0005 stores only a SHA-256 hash of the token, so a copy of the database or of a backup does not hand out live sessions. Better Auth has no option to hash them.
- **Transactions.** Better Auth writes through its own adapter on the connection pool. Enan runs each request in one immediate SQLite transaction (ADR 0029), and a second immediate transaction opened on the pool inside a request waits on the request's own write lock.

Keeping the protections would have meant wrapping or overriding most of what the library does, and every existing scenario for ADMIN-B20–B22 and ACCT-B02–B03 would have to be re-proven against new code. The three features themselves are small: an SMTP client, a code table, and one OAuth authorization-code exchange.

The issue also put the SMTP and Google credentials in environment variables only. The maintainer asked for them to be configured from Administration instead, as the OpenRouter key already is (ADMIN-B24).

## Decision

- **The own auth stays** (ADR 0005, ADR 0013). Email codes and Google sign-in are added to it as two more ways to reach `newSession`, and they share its throttle, its session table with hashed tokens, its `is_active`/`deleted_at` checks and its audit. Better Auth is not adopted. Existing users, password hashes and sessions are unchanged, so nothing is migrated and nobody signs in again.
- **Outgoing mail uses SMTP through `nodemailer`**, the one new dependency. Mail only travels encrypted: port 465 is TLS from the first byte, and any other port must upgrade with STARTTLS or nothing is sent. Certificates are verified, and messages may not pull in local files or URLs.
- **Credentials for other services are sealed in their own tables**, never in `settings` (ADR 0005). `core/auth/sealed.ts` encrypts with AES-256-GCM under a key derived from `SESSION_SECRET` by HKDF. Each kind of credential derives its own key (the AI key keeps the derivation it already had), and the row's identity is bound as associated data, so a sealed value opens only as the kind and row it was written for. A value that does not open fails closed. The mail server is the `mail_settings` row (ADMIN-B60).
- **A saved configuration overrides the environment.** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` and `MAIL_FROM` apply while nothing is saved, as `OPENROUTER_API_KEY` does for AI.
- **Secrets are never read back.** APIs return whether a password is saved, never the password or its sealed form. Audit entries name what changed without the secret.

## Consequences

- Changing `SESSION_SECRET` makes saved mail and Google credentials unreadable, as it already does for the AI key: they must be entered again. Backups keep them sealed and need the original `SESSION_SECRET`.
- An SMTP server that offers no encryption cannot be used. That is deliberate: sign-in codes will travel by mail.
- The auth code grows by the two sign-in methods instead of being replaced, and remains code the project owns and tests.
- Passkeys, Microsoft and generic OIDC (the issue's follow-ups) will be added the same way, or will reopen this decision with a new ADR if a library becomes worth its cost.

## Alternatives considered

- **Better Auth, as the issue proposed.** Rejected for the session-token and transaction conflicts above; the rewrite risk bought features that are small to build.
- **Environment variables only for SMTP and Google**, as the issue proposed. Rejected at the maintainer's request: an office should be able to set up email from the browser, and the AI key already shows the sealed-row pattern works.
- **Store the credentials in `settings`.** Rejected: the settings registry is readable by every administrator query and refuses secret-like keys by design (ADR 0005).
