# ADR 0066 — Internal people link to workspace logins by their address

**Status:** accepted (2026-10-28). Extends ADR 0011.

## Context

People are the only owner identity (ADR 0011), and a notification is addressed to a login, never to a person (ADR 0022). A person reaches a login only through `people.user_id`, which until now an administrator set by hand. In practice an office adds its colleagues to the directory and gives them logins separately, so most internal people were never linked: their tasks, mentions and the new KPI reading reminders (KPIS-B30) reached nobody, and nothing on screen said why.

## Decision

- **An address match links.** An internal person whose email equals, case-insensitively, the address of an active login that no directory record holds yet is linked to that login: when the person is created, when a patch makes them internal or gives them that address, and when the login is created after the person. Logins store their address in lower case, so the match is exact on the login's side.
- **Only an unambiguous match links.** A login already held by a record (live or trashed, since `people.user_id` is unique across both) is not taken; two live, unlinked internal records with the address link neither, and the directory resolves which one it is.
- **An explicit link wins.** An administrator's `userId` on a create or patch is applied as before, and the link is never removed by this rule.
- **The record says whether it reaches anyone.** An internal record shows, under its kind, whether it is linked to a login, and a KPI's reminder switch says whether its owner has one.

## Consequences

Colleagues added with their work address start receiving what concerns them without an administrator linking each one. A member can create a record that links to another member's login, but only to the login whose address that record carries, which is the identity the link asserts; the administrator-only rule for choosing an arbitrary login (PEOPLE-B01) is unchanged. An external contact never links, whatever address they carry.

## Alternatives considered

- Keep linking manual: rejected; reminders and assignments silently reached nobody.
- Link on a name match: rejected; names repeat and are spelled several ways, addresses are unique per login.
