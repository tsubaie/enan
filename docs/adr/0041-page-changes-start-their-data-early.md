# ADR 0041 — Page changes start their data early and prefetch on intent

**Status:** accepted (2026-10-19)

## Context

Issue tsubaie/ExecutiveOS#79 measured a page change in production at about 2.7 s. Most of it was not new and not on the server: the page payload took one round trip, then the page's data took a second, and the second waited about 0.4 s for the page-in view transition (ADR 0019), because the lists and Home started their fetch in an effect and effects run after the transition. Home also set off 15–18 page prefetches on every visit, which queued in front of the navigation the reader made. The Tasks list asked for every task, learned the default view from the answer, and asked again for that view. Committee choices and assignable people were fetched on every visit. Responses carried no timing, so a slow one could not be placed at the edge or at the origin.

## Decision

- **A page's data starts while the page renders.** Every list hook and Home's hook calls TanStack's `usePrefetchQuery` / `usePrefetchInfiniteQuery` with the same options as the query it then reads, so the request leaves during render, before the view transition and its effects. Server-rendering the first page into the payload, which would remove the second round trip as well, is left for later: it changes every module's page.
- **The menu, the phone bar and Home's links prefetch on intent** (`IntentLink`): a pointer over the link, focus, or a touch. Nothing is prefetched because a link scrolled into view.
- **The Tasks list asks for its default view in the same request** (`view=default`, TASKS-B18) and keeps the answer under the resolved view, which the page then writes into its URL without fetching again. The list stays fresh for its 30 s poll interval.
- **Reference data is cached:** committee choices and assignable people stay fresh for five minutes; every committee or people mutation invalidates them.
- **API responses carry `Server-Timing`** (ADMIN-B49).
- **The fonts stay as they are.** Noto Sans Arabic already loads as one variable file (166 KB) for the Arabic subset, and Google serves the same file whatever weight range is asked for, so trimming weights saves nothing. A smaller file would need a self-hosted, glyph-subset font.

## Consequences

- A page change saves the transition's wait on its data fetch, and a page of links no longer competes with the click.
- The first hover over a menu entry costs a page prefetch; a click without hover (a keyboard Enter after focus also prefetches) loads the payload on click, as it would have for any link not yet in view.
- The blur and the page-in delay that ExecutiveOS#79 also lists are visual decisions and are not part of this ADR.
