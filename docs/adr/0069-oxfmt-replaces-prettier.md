# ADR 0069 — oxfmt replaces Prettier, and formatting is checked

**Status:** accepted (2026-11-01)

## Context

`pnpm format:check` ran Prettier over the repository in 4.3–4.45 s (three runs), and nothing ran it: neither `audit:all` nor CI. On `main` at 76ec1d6, 90 files did not match Prettier's own output, mostly long lines that were never wrapped. oxfmt, the Oxc formatter (the project already lints with Oxlint, ADR 0042), checked the same 1055 files in 0.064–0.066 s. After formatting everything with Prettier, oxfmt formatted 5 files differently, all of them line breaks: unions it puts one member per line, a method chain it keeps on one line, and one line with Arabic diacritics that it measures narrower.

## Decision

- **`pnpm format` and `pnpm format:check` run oxfmt** (`oxfmt`, `oxfmt --check`, pinned to an exact version) with `.oxfmtrc.json`, converted from `.prettierrc.json` and `.prettierignore` by `oxfmt --migrate=prettier`: the same options (single quotes, trailing commas, width 100) and the same ignored paths. Prettier, `.prettierrc.json` and `.prettierignore` are removed.
- **`audit:static` runs `format:check`** after lint, so CI fails on unformatted files.
- **The repository is formatted once with oxfmt** in the same change; it touches whitespace and line breaks only.

## Consequences

- Formatting drift is caught in CI instead of accumulating. The check adds well under a second to `audit:static`.
- Editors set to format with Prettier produce the 5 kinds of difference above; `pnpm format` before committing, or the oxfmt editor integration, avoids a failed check.
- `next dev` rewrites a heading in `AGENTS.md` locally (a block it owns); left uncommitted it fails `format:check` until reverted or committed.

## Alternatives considered

- **Keep Prettier and add `format:check` to the gate.** Works, at about 4.4 s per run, and keeps a JavaScript formatter beside a Rust linter. Rejected.
- **Biome.** Formats and lints, but its linter would duplicate Oxlint and our rules run on Oxlint's plugin support (ADR 0042). Rejected.
- **Switch the formatter without enforcing it.** Leaves the 90-file drift and the reason it happened. Rejected.
