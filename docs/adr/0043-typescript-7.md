# ADR 0043 — TypeScript 7, and dependency-cruiser parses with swc

**Status:** accepted (2026-10-21)

## Context

Issue tsubaie/enan#6 measured `tsc --noEmit` at 9.4 s on TypeScript 5.9.3 and 1.5 s on TypeScript 7.0.2, both with no errors. Once Oxlint replaced typescript-eslint (ADR 0042), only dependency-cruiser still needed TypeScript 5: up to 18.7.0 it supports `typescript <7.0.0`, because TypeScript 7 does not yet publish the compiler API it reads.

## Decision

- **`typescript` is 7.0.2**, the only TypeScript installed. `pnpm typecheck` (`tsc --noEmit`) runs on it unchanged, and so does the type check inside `next build`, which runs the project's own `tsc` since Next 16.3 (`experimental.useTypeScriptCli`, on by default).
- **dependency-cruiser parses with swc** (`parser: 'swc'`, `@swc/core` pinned exactly). It finds the same 666 modules (2,737 dependencies against 2,736) and the same rule results. swc labels imports `undetermined` instead of `type-only` or `aliased`; no rule in `.dependency-cruiser.cjs` uses `dependencyTypes`, so that does not change what is enforced. A rule that needs those labels would need this decision revisited.
- dependency-cruiser still prints a `missing-typescript-transpiler` notice. It is a warning that does not fail `pnpm depcruise`, and the module count shows nothing was missed.
- **TypeScript 7.1 waits** (#6, step 2): its betas report TS5115 ("Instantiations … appear infinitely circular") on Zod 4's inferred JSON types.

## Consequences

- `pnpm typecheck` drops from about 9 s to about 2 s, and the type check inside `next build` (and so the container image job) shrinks the same way.
- `tsc` errors from `next build` are printed in `tsc`'s own format, without Next's code frames.
