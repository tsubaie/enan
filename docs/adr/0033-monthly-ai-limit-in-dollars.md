# ADR 0033 — The monthly AI limit is in US dollars

**Status:** accepted (2026-10-18). Supersedes the workspace monthly token budget of ADR 0017.

## Context

ADR 0017 limited AI use with a workspace monthly token budget. The maintainer pays OpenRouter in dollars, and a token means a different price on every model, so a token figure says little about what a month will cost. Every invocation already records an estimated cost from the catalog prices snapshotted in its job.

## Decision

- The monthly limit is a US dollar amount, held in the setting `ai.monthly_budget_micros` as integer micro-dollars (millionths of a dollar), or null for no limit. Micro-dollars are the unit `ai_invocations.estimated_cost_micros` already uses, so the limit, the spend and the reservations are compared without conversion or rounding; cents would be too coarse for a single request's reservation, which is often a fraction of a cent. The administration page shows and accepts dollars to the cent.
- Admission keeps ADR 0017's conservative shape in money: each job snapshots `reservedCostMicros`, the cost of two attempts of the estimated input at the model's input price plus the full output allowance at its output price, rounded up. A request is refused (`ai_unavailable`, reason `budget`) when this month's estimated spend, plus the reservations of active jobs, plus its own reservation, passes the limit. A reservation is released when its job ends; the invocations it made then count at their estimated cost.
- A call whose usage was lost retains half the job's cost reservation (one attempt) as its estimated cost, as it already retains half the token reservation.
- The 80% warning on the administration page reads spend plus reservations against the dollar limit. Tokens remain recorded and are shown as secondary information.
- The old setting `ai.monthly_token_budget` is retired, not converted: a token count has no single dollar value across models, so any stored value is no longer read and an existing workspace starts with no dollar limit until an administrator sets one. Jobs queued before the change carry no cost reservation and reserve nothing against the limit.

## Consequences

The limit means what the maintainer pays, within the accuracy of catalog prices; OpenRouter billing stays authoritative. Free models never approach the limit. A workspace that had a token budget loses that cap on upgrade and must set a dollar limit. Conservative reservations can still refuse a request a month could have afforded.

## Alternatives considered

- Keep the token budget as a second cap: rejected; two limits on one page in different units would confuse the one decision the administrator makes, and tokens do not track cost.
- Convert the stored token budget at the current model's prices: rejected; the result would depend on which model happened to be selected and would silently invent a spending policy.
- Store cents: rejected; reservations and per-call estimates are sub-cent and are already stored in micro-dollars.
