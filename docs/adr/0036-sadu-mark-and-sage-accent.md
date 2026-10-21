# ADR 0036 — The Sadu mark, and a sage accent in the night theme

**Status:** accepted (2026-10-18); its fixed accent is superseded by ADR 0037, which keeps sage as the fallback, and its mark by ADR 0046. Supersedes the night accent of ADR 0031 (light indigo `#c4c2ff` over an indigo tint); the rest of ADR 0031 stands.

## Context

The side menu showed a ⌘ glyph beside a fixed product name. The owner asked for a logo that represents Arabic culture, chose a Sadu weave motif from six studies (Najdi doorway, Sadu weave, dallah, rosette, falcon, Qamariya arch), and then asked for it in green rather than purple, and for every purple tint in the interface to become that green.

## Decision

- The mark is a Sadu unit: the diamond the Bedouin loom repeats along its bands, between two woven chevrons, drawn in `currentColor` on a 24-unit grid (`src/ui/layout/Logo.tsx`) and as the favicon (`public/icon.svg`). It never mirrors in right-to-left layouts. Beside it the side menu shows the workspace's own name (`workspace.name`).
- The night accent is a sage green: `--accent` `#9ad8b4` over `--accent-soft` `rgb(84 170 124 / 0.24)`, with `--on-accent` `#0b2418`. The paper accent was already green (`#2e6b54`, ADR 0030) and is unchanged, so both themes now share one hue family. The mark wears the accent, so the logo and the interface's markers are the same colour.
- Nothing else in ADR 0031 changes: the drawn `indigo` wallpaper keeps its violet light, because it is a wallpaper and not a tint, and the status hues keep Apple's values.

## Consequences

- The accent ink rises from 5.1:1 to about 11:1 on the night canvas, so every place that used it stays readable.
- The accent and the success green are now close in hue. Success always comes with its word or icon (05 § colour is never the only signal), so the two are not confused; the accent still is never a fill, tag colour or button colour.
