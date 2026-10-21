# ADR 0042 — Oxlint replaces ESLint

**Status:** accepted (2026-10-21)

## Context

Issue tsubaie/enan#7 measured `pnpm lint` over the whole repository at 11.3 s with ESLint and typescript-eslint, the slowest step of `audit:static`, against 0.4 s with Oxlint, and neither reported a problem. typescript-eslint also requires `typescript <6.1.0`, which keeps the project on TypeScript 5 (#6). Oxlint parses TypeScript itself and does not load the `typescript` package.

## Decision

- **`pnpm lint` runs Oxlint** (`oxlint --max-warnings=0 .`, pinned to an exact version) with `.oxlintrc.json`, converted from the ESLint configuration by `@oxlint/migrate`: the `eslint-config-next` rules (core web vitals and TypeScript) and our own overrides. ESLint, `eslint-config-next`, `typescript-eslint` and `eslint.config.mjs` are removed.
- **Our rules stay in `tools/eslint/`**, unchanged, and run through Oxlint's support for ESLint plugins (`jsPlugins`, named `eos` because the plugin has no `meta.name`). Their tests (`scripts/audit/tests/static-rules.test.mjs`) run them through Oxlint's `RuleTester`, so they are tested the way `pnpm lint` runs them.
- **Inline lint directives are rejected by `audit:structure`.** ESLint's `noInlineConfig` has no Oxlint equivalent, and a directive can switch off any lint rule that would catch it, so the audit rejects `eslint-disable`, `oxlint-disable`, their `-enable` forms and `/* eslint … */` comments in source files. Oxlint's `reportUnusedDisableDirectives` stays at `error`.
- **No side-by-side period.** Both linters gave the same result on the repository and on planted violations of every `eos` rule, so ESLint goes in the same change.

## Consequences

- `audit:static` loses about 11 s, and nothing loads TypeScript 5 except dependency-cruiser, which #6 moves to swc.
- Not carried over: `@next/next/no-location-assign-relative-destination` (not implemented in Oxlint) and the React Compiler settings `react-hooks/config` and `react-hooks/gating` (Oxlint uses fixed compiler options). `react/require-render-return` is a nursery rule in Oxlint and stays off. The rest that the migration skipped are unneeded with the new JSX transform or covered by another rule.
- Oxlint's ESLint-plugin support is alpha and not subject to semver. Oxlint is pinned exactly, and every `eos` rule has `RuleTester` cases that fail if an upgrade stops running it; an Oxlint upgrade is a reviewed change, never a range bump.
