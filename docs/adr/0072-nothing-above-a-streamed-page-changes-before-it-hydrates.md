# ADR 0072 — Nothing above a streamed page changes before it hydrates

**Status:** accepted (2026-11-23). Replaces `next-themes` with an in-repo theme provider; ADR 0019's reveal and the place of every provider are unchanged.

## Context

Pages stream: the root and `(app)` layouts reach the browser first, and each page arrives later behind a Suspense boundary (`loading.tsx`). The browser parks a page that is not shown yet in a hidden `<div id="S:…">` until React's reveal script moves it into place.

On CI, CAPTURES-A03 and CAPTURES-A01 found a page twice: once in `main` and once as a parked copy left in `body > div[hidden][id^="S:"]` (#164). The trigger was the theme provider.

- `next-themes` keeps the system's colour scheme in its context value and reads `prefers-color-scheme` in an effect after mount.
- Under a light system scheme that read changed the value, even though the app's theme is always the one read on the server (ACCT-B04) and never follows the system. React treats a context change above a boundary that has not hydrated yet as an update to that boundary. It can render the boundary again on the client, and the server's copy is then never revealed.
- Under a dark scheme the value stayed the same, which is why only light runs failed.

## Decision

- **Invariant: no context value above a dehydrated Suspense boundary may change before hydration finishes.** That covers every provider in the root and `(app)` layouts. A value that must change after load lives in a store read through `useSyncExternalStore`, whose server snapshot is what the server rendered. The context carries only things made once: the store and its setters.
- **The theme follows it.** `src/ui/theme/ThemeProvider.tsx` keeps a store made once from the server's theme. Its context value is `{ store, setTheme }` and never changes. `useTheme()` reads the store through `useSyncExternalStore`, and its server snapshot is the server's theme. Nothing reads `prefers-color-scheme`, because the app has no "follow the system" option.
- **The pre-paint script stays.** The provider writes the same inline script (with the request's nonce, ADR 0025), so the first paint already has the theme's class and colour scheme.
- **A provider inside another passes its children through,** as `next-themes` did for the `(app)` layout's `Providers`.
- `next-themes` is removed.

## Consequences

- A theme change after load, from the setter or a later server render, reaches readers through the store. React re-renders only those readers and touches no boundary that is still streaming.
- A new provider in a layout is reviewed against the invariant. A value derived from the device (media queries, storage, the clock) goes into a store with a server snapshot, never directly into the context value.
- e2e guards that no parked `S:` segment is left after hydration on three streamed pages in both colour schemes. A unit test counts a reader's renders across hydration under each system scheme.
- With no context update above it, a page's boundary now hydrates on React's own schedule, about 390 ms after navigation start rather than about 100 ms, and a click before that is dropped (the same as dark-scheme runs before this change). The browser suite waits for `html[data-hydrated]` before a first interaction: `src/ui/layout/HydrationMark.tsx` sets it once a page's own boundary (`PageBody`) and the shell's recorder boundary have both mounted, and clears it when the page goes. **This readiness gate is test-only**; nothing in the product reads it. The real hydration latency is tracked separately in #171.

## Alternatives considered

- **Moving the theme provider so it wraps no page.** This removes the trigger, but each page then waited for the reveal transition to end before it could hydrate, and early clicks were dropped in about ten e2e scenarios. Rejected.
- **Patching the mismatch with `suppressHydrationWarning`.** This hides the warning, not the update, so the parked copy stays. Rejected.
- **Keeping `next-themes` and memoising around it.** Its value includes `systemTheme` and `resolvedTheme`, which change after mount by design. Rejected.
