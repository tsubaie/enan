# ADR 0038 — The route bundle budget is 300 KB

**Status:** accepted (2026-10-18). Supersedes the 272 KB figure of ADR 0023; the rest of ADR 0023 (what the metric counts, why headroom is kept) stands.

## Context

ADR 0023 set the budget at 272 KB of gzipped route-specific client JavaScript, with headroom over the worst route of the day. The night-theme redesign since then put more into the code every route can reach: the glass card and table pieces, row reordering with the swap glide, the language toggle in the header, the Sadu mark, and the accent that follows the wallpaper. Every list and admin route now measures about 265 KB, and the People page, which adds its own directory on top, measures 278 KB. Nothing server-side reaches the client; the growth is interface code the owner asked for.

Trimming below 272 KB would mean splitting shared entity code that every list page uses at once, which the metric does not reward: it counts what a route can reach, not what it loads, so a lazy boundary does not move it (ADR 0023).

## Decision

- **The route budget is 300 KB gzipped**, up from 272 KB: the current worst route (278 KB) plus about 22 KB of headroom, set by the owner so the redesign's remaining work has room and the gate stays a budget rather than a snapshot.
- The root bundle stays reported as a warning so its growth remains visible.

## Consequences

- `scripts/audit/bundle.ts` and `09-audit-checklists.md` carry 300 KB.
- Reducing the shared entity and shell code is follow-up work; when it lands, a later ADR can lower the figure again.
