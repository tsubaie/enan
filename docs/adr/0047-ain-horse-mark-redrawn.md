# ADR 0047 — The ع-horse mark, redrawn

**Status:** accepted (2026-10-22). Supersedes the traced path of ADR 0046; the rest of ADR 0046 stands.

## Context

ADR 0046 noted that the mark was a trace of a raster study: 110 points, small wobbles along the bowl and neck, uneven stroke weights, a notch under the muzzle that read as a dog's lip, and a sharp corner where the jaw met the neck. The owner compared it with a redraw and chose the redraw.

## Decision

- The mark is the same idea and silhouette, redrawn by hand as one path of 22 points on a 256-unit square, centred, about 87% of the square tall, the same size as before.
- The neck, the lower bowl and the baseline bar share one stroke weight. The muzzle is one rounded nose over a clean jaw, the jowl is round, the face has a slight Arabian dish, and the ear leans forward.
- It has no eye: at the sizes the app uses (22 px in the menu, 16 to 32 px as a favicon) an eye would be a speck.
- `src/ui/layout/Logo.tsx`, `public/icon.svg` and `docs/enan-mark.svg` carry the new path; colours and the never-mirror rule are unchanged.
- The masters live in `resources/`: `enan-mark.svg` in `currentColor`, `enan-mark-black.svg`, and a 1024 px PNG, each a centred 1024-unit square.

## Consequences

- The path is small and smooth enough for print and signage without a further redraw.
- At 32 px the head reads more clearly than the trace did; at 16 px the mark still reads as the letter with an ear.
