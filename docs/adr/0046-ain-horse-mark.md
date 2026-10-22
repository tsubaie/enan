# ADR 0046 — The ع-horse mark

**Status:** accepted (2026-10-21); its traced path is superseded by ADR 0047, which redraws the same mark. Supersedes the Sadu mark of ADR 0036; its sage accent, and ADR 0037, stand.

## Context

The product is named عِنان, the rein of an Arabian horse. The Sadu mark of ADR 0036 represented Arabic culture in general but not the name. The owner asked for a mark that joins the letter ع and an Arabian horse, flat and simple, and chose this one from several AI-generated studies; it was then traced to a single vector shape.

## Decision

- The mark is the letter ع whose upper curve becomes the horse's neck and head, with one ear and a squared muzzle, sitting on a flat baseline like a printed ع. It is one filled path in `currentColor` (`src/ui/layout/Logo.tsx`). It never mirrors in right-to-left layouts.
- The favicon (`public/icon.svg`) is the mark in the dark green `#12241b` on a transparent background, switching to the sage accent `#9ad8b4` when the browser prefers a dark scheme, so it stays visible on dark tab bars.
- The README mark (`docs/enan-mark.svg`) is the mark in sage on the dark rounded tile.

## Consequences

- The path is a trace of a raster study, so it carries more points than a hand-drawn vector. It is fine on screen; print, signage or a trademark filing need a designer's redraw from it.
- At 16 px the mark reads as the letter with an ear; the horse needs 32 px or more.
