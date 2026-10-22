# ADR 0049 — An install may supply its own Arabic faces

**Status:** accepted (2026-10-22). Extends ADR 0032; Noto Sans Arabic stays the default.

## Context

The owner's own sites set Arabic in Thmanyah. Its licence allows use in websites and apps but forbids uploading, hosting or redistributing the font files outside Thmanyah's own site. Enan's repository is public under Apache-2.0, so the files cannot live in it, and the app must not fetch fonts from another site (ADR 0029, the content security policy).

## Decision

- `FONTS_DIR` (default `/var/lib/enan/fonts`) may hold `text-<weight>.woff2` and `display-<weight>.woff2`. When it does, the root layout links `/api/v1/fonts/faces.css`, which declares them as `Enan Arabic` and `Enan Arabic Display` over the Arabic block only, and sets two custom properties that place them in front of Noto in the text and display stacks (ADMIN-B51).
- `GET /api/v1/fonts/<file>` is public, because the sign-in page uses the same type, and answers only names of that exact form, so it reaches nothing else in the directory.
- The repository ships no fonts for it. An install adds files it is licensed to serve, for example through a read-only volume in its Compose overlay.

## Consequences

- An install without the files is unchanged.
- A weight the install does not supply is drawn in its nearest supplied weight (a light 300 shows at 400); only Arabic characters the faces lack fall through to Noto Sans Arabic, so the text never drops to a system face.
- Licensing the files is the operator's responsibility.
