# ADR 0064 — Passkeys through Better Auth

**Status:** accepted (2026-10-27). Extends ADR 0055.

## Context

Issue #96 asks for passkeys: signing in with a fingerprint, face or device PIN instead of a password. ADR 0055 made sign-in Better Auth's, and Better Auth publishes a passkey plugin (`@better-auth/passkey`, on SimpleWebAuthn) at the same version as the core. Enan's rules for every way in (a method an administrator can switch off, throttled attempts, every sign-in in the audit log, a deactivated account refused) must hold for this one too.

## Decision

- **The plugin, at the core's version.** `@better-auth/passkey` 1.7.12 stores credentials in `auth_passkeys` (migration 0017), with the relying party taken from `APP_URL`. It runs in the process and the one SQLite file like the rest of Better Auth (ADR 0029).
- **A method like the others.** `passkey` joins `auth.sign_in_methods`, off by default: nobody has a passkey until they add one. The sign-in endpoints are refused while it is off, failed attempts count against the client address (a passkey names no email), and sign-ins and failures reach the audit log by the same hooks as the other methods.
- **Enan's own step-up for adding one.** The plugin's rule (a session under a day old) is replaced by Enan's: the current password while password sign-in is on, otherwise a session under ten minutes old. It is checked where the passkey is stored, because the plugin's client sends extra headers with that request only. Registering never opens a session.
- **No lockout by removal.** While passkeys are the only method in effect, a member's last passkey cannot be removed.
- **Fewer endpoints.** Better Auth's passkey listing and renaming are disabled: the account page lists passkeys through `GET /account`, and adding and removing are audited.

## Consequences

- A passkey is bound to the host in `APP_URL`; changing it leaves existing passkeys unusable until members add new ones.
- A wrong password is found only after the browser has made the passkey, so the authenticator may keep one the server never stored.
- An administrator who turns on passkeys alone relies on every member having added one; `RECOVERY_TOKEN` still turns password sign-in back on (ADMIN-B22).

## Alternatives considered

- **SimpleWebAuthn directly.** Duplicates what the plugin does, outside the sessions Better Auth already issues.
- **The plugin's own fresh-session rule.** A day-old session is long enough for a stolen one to add a passkey and keep the account.
