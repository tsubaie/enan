# ADR 0027 — The database URL's host part is the only place the server is named

**Status:** superseded by ADR 0029 (2026-10-16). Kept for history; `DATABASE_URL` is now a `file:` URL and names no server.

## Context

ADR 0025 classifies the database host as Compose-private or remote from `new URL(DATABASE_URL).hostname`, and requires `sslmode=verify-full` for a remote host. Review of #62 showed that node-postgres does not always connect to that host:

- a `?host=` query parameter overrides the authority, so `postgresql://u:p@localhost/app?host=db.example.test&sslmode=disable` was classified as loopback while the pool connected to the remote host with TLS off. `sslmode=disable` was not even needed: node-postgres defaults to no TLS;
- an empty authority (`postgresql:///app`) counted as private, and node-postgres then takes the host from `PGHOST`;
- `pg_dump` and `pg_restore` were given the authority's host and port, so with `?host=` or `?port=`, or with an absent port and `PGPORT` set, backups and restores reached a different server from the application;
- ADR 0025 calls Unix sockets private, but the usual URL form for one, a percent-encoded directory in the authority, was classified as remote and refused.

## Decision

The authority (`@host:port`) is the only place `DATABASE_URL` may name its server. Startup refuses, with a message naming the fix:

- any `host`, `hostaddr` or `port` query parameter;
- an empty host;
- a scheme other than `postgresql://` or `postgres://`.

A Unix socket is written as a percent-encoded directory (`@%2Fvar%2Frun%2Fpostgresql`). The policy decodes the host before classifying it, so a host that starts with `/` is private. The decoded path is what `pg_dump` receives. The pool's connection string always carries an explicit port, so node-postgres never falls back to `PGPORT` while `pg_dump` uses 5432.

This refines ADR 0025's host classification. Its TLS requirements are unchanged.

## Consequences

- Only one server can be reached through `DATABASE_URL`, and the TLS policy, the pool and the backup commands all see it.
- A `DATABASE_URL` that used `?host=` for a socket must move the directory into the authority, percent-encoded. The startup message gives the form. The documented configurations (`@db:5432`, `@localhost:5432`) are unaffected.
- `PGHOST` and `PGPORT` no longer influence where the application connects.

## Alternatives considered

- **Resolve the effective target the way node-postgres does and classify that.** This would mean importing `pg-connection-string` directly (a new dependency) and tracking its precedence rules and libpq's through every upgrade, and the backup commands would still need the same answer. Refusing the ambiguous forms needs neither. Rejected.
- **Allow `?host=` when it agrees with the authority.** This keeps two ways to say one thing for no benefit. Rejected.
