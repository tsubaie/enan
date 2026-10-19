# ADR 0032 — Inter and Noto Sans Arabic carry the whole interface

**Status:** accepted (2026-10-18). Supersedes the font choices of ADR 0030 (IBM Plex Sans Arabic for text, Noto Naskh Arabic and Newsreader for titles) and the "system face first" line of ADR 0031.

## Context

The maintainer first wanted Apple's own fonts. Apple licenses SF Pro and SF Arabic only for its own platforms; they are not web fonts and may not be bundled or hot-linked, so they could only ever appear on Apple devices, and the interface looked different on every other one. Thmanyah was tried for Arabic and removed. The maintainer then chose one Arabic face for every device (Noto Sans Arabic) and asked that English be unified the same way.

## Decision

- **Two faces carry everything, on every device:** Inter for Latin (the open face closest to SF Pro) and Noto Sans Arabic for Arabic, body text and titles alike. No system face, no serif, no per-platform difference. Both load through `next/font`; nothing is fetched at run time.
- **Inter comes first in every stack, named on its own.** Inter has no Arabic glyphs, so each Arabic character falls through to Noto while Latin, digits and punctuation stay in Inter. The order matters twice over: Noto carries Latin glyphs of its own, and the Arial-based fallback face next/font pairs with Inter covers Arabic, so either one placed ahead of the other would take over the wrong script. The stacks are therefore `'Inter', var(--font-arabic), sans-serif`.
- **Weight carries the hierarchy, in both languages.** Only the day's headline on Home is Extra Light (200), the one hero. Page titles in the header are 20 px Semibold (600), as a macOS window titles its toolbar. Group headings ("Overdue", "متأخرة") are Regular (400). Every record's title (a task, a note) shares one style: 22 px Semibold (600). Names (a task, a note, a committee) are Medium (500). Descriptions (a card's excerpt, a record's description, a committee's secondary line) and the views menu are Light (300), so the names stand out against them. Body text and controls are Regular.
- Monospaced type is kept only where the content is code (identifiers and templates in administration).

## Consequences

- The interface looks the same on a Mac, Windows and Android, in both languages.
- Mixed lines (an English acronym or a year inside an Arabic title) set each script in its own face without any per-element markup.
- A new face, or a change of stack order, has to be checked with the browser's rendered-font report on Arabic and Latin text, not by reading the stylesheet: two of the stack orders tried here looked right and rendered the wrong script.
