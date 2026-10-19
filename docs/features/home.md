# Feature: Home

**Status:** accepted
**Spec reviewed:** 2026-10-18 (redesign: the page as glass widgets, HOME-B15)
**Implementation verified:** not yet
**Owner module:** `src/modules/home`

## Purpose

The one screen the principal opens first. It is a set of queries over existing modules, not an AI product: what is next, what is not ready, what is overdue, what is waiting for review.

## Behaviors

- HOME-B01 Sections, each with a count, up to 5 items, and a "View all" link into the module's matching view.
  Every item carries the facts the principal triages on, supplied by the owning module so the page never
  re-queries: the date it turns on (due date, note date), the person holding it, the committee it belongs to,
  how much open work it represents, and — where the row is a measure rather than a piece of work — the
  state word from the owning module's vocabulary and how far through its limit it is. A row shows one
  status fact chosen by the question its section answers (how late, who holds it, how much is open, when it
  happened) plus the committee. Each section is one widget tile (HOME-B15): its heading, its count
  and "View all" in the tile's head, its rows below with hairlines between them. A KPI row draws its proportion as the scorecard's own arc and prints its
  share of the target and its state in the scorecard's words and tone (KPIS-B07), so the row answers the
  question without a click; it does not repeat the objective the measure serves, which the scorecard
  already groups by. The two task sections, **Overdue actions** and **Due today**, answer one
  question — what do I have to do — and are one view in Tasks, so the page draws them as one **Actions**
  block with two bands: the header states both counts, the overdue band carries the danger count and the
  ageing split (HOME-B09), the due-today band stays neutral, a band with nothing in it is not drawn, and
  the block's "View all" opens the today view. *Changed 2026-10-18:* the header states the sum of the
  two bands, and each band's head states its own name and count; the header no longer repeats the
  band names, which said each count twice. A zero band is still an answer: the headline states the
  day (HOME-B07) and the ledger's first entry states the overdue count (HOME-B05). They remain two sections in the payload, each owned and
  counted as before. Every row in the grid that leads with something — the check, a face, an arc —
  leads with it in one 28 px slot, so titles align across the columns and the grid reads as one
  instrument; rows that lead with nothing have no slot. *Changed 2026-10-18:* recent notes is the last
  tile, a list of rows like every other tile with a quieter heading; it no longer spans two columns
  as a row of cards, because the Actions tile now sets the grid's height (HOME-B07) and the page no
  longer ends on a hole.
  Row facts are set at 13 px: one step above the framework's 12 px, because they carry the triage
  facts for an audience the density rules describe as over forty on tablets. "View all" is muted
  and takes the accent on hover and focus; a row washes on hover and does not lift, because the glass
  around it does not move; the week block's link alone carries a chevron, because it
  is the one that changes what the reader is looking at. A KPI row without a reading says so in
  place of the proportion. The sections:
  1. **Next meetings** (next 3 upcoming, with prep status badge for the user's locale; joins the week block, HOME-B14)
  2. **Prep not ready** (`meetings?view=needs_prep`)
  3. **Overdue actions** (`tasks?view=today` overdue band, top-level only)
  4. **Due today** (band today)
  5. **Waiting on** (`waiting_on` tasks with owner)
  6. **Committees with open work** (active committees carrying open top-level tasks, busiest first, `committees?view=open`)
  7. **Pending AI reviews** (pending note refinements, ready briefs without feedback from me, learnings proposals if admin)
  8. **Attention KPIs** (`kpis?view=attention`)
  9. **Initiatives at risk** (`initiatives?view=at_risk`)
  10. **Recent notes** (non-archived notes dated within the last seven days, `notes?view=this_week`; NOTES-B14)
  *Changed 2026-10-18, round 2:* every row is a primary label in full ink (15 px Regular; a waiting holder's name Medium) over a 13 px Light muted secondary line, 4 px apart, and titles and names wrap to two lines rather than truncating, with the whole text on the link's title. An overdue row's age is muted with only the span of days in the danger ink. A KPI row leads with its reason as a status chip in the scorecard's words and hue (KPIS-B07) above its name, with its share of the target muted under it; the arc is gone, because it read as a loading spinner and drew 99 % and 100 % alike. The Actions band head is one quiet muted line: the band's name, its count and, for overdue, how much is a month or more late. The tile's header carries the sum of the bands.
- HOME-B02 A section whose module is not installed is omitted from the page entirely: an absent module is
  an administration fact, not something the principal acts on, and a list of "not enabled" rows crowds out
  the live ones. An installed section stays visible at zero items, collapsed to its single heading line,
  because zero overdue actions is an answer. An installed section with nothing in it answers its own
  question where it has one — "No committee is carrying open work", "Nothing is waiting on anyone",
  "Every KPI is on track", "No notes this week", "Nothing is late or due today" — and says the
  generic line only where it does not. When no section is installed the page shows one empty state
  pointing at Administration rather than an empty box.
  *Changed 2026-10-18, round 2:* an installed section with nothing in it is no longer drawn as a tile. The sections with nothing in them, Actions included, are named together in one quiet line after the tiles, joined the way the reader's language joins a list ("No committee with open work and no notes this week.").
- HOME-B07 The page opens on the day ahead: the workspace date, then how much needs the principal
  today. It never opens on how far behind they are. *Changed 2026-10-18 at the owner's request:* the
  headline never contradicts the ledger under it, so it is chosen from the same sections: when
  something is due today it says how many tasks are due; otherwise, when work is overdue or a KPI or
  initiative needs attention, it says nothing is due but how many things need the principal (the sum
  of the overdue, attention-KPI and at-risk-initiative counts — waiting work is someone else's to
  move and is not counted); and "Nothing needs you today" only when all of those are zero. The
  headline is set at the page-title scale (20 px Semibold) under a quiet date line, not as a 36 px
  hero; the page opens calmly and the tiles carry the detail. Leading with the overdue count turns the first
  thing they read every morning into a reprimand, and on a clear day it makes a headline out of
  nothing being wrong; the lateness warning belongs in the overdue band, where it is already
  unmissable. The week block (HOME-B14) leads at full width, the first tile under the headline,
  whenever the module that owns dated work is installed. *Changed 2026-10-18:* it is the same glass
  tile as the sections (HOME-B15); its position and width make it the lead, not a material of its own. It is fixed rather than "whichever
  section has something in it": an executive orients on time, and a lead that is Overdue on a bad
  morning and Attention KPIs on a quiet one gives them nothing to orient on. Below it the sections sit in
  one grid of three columns from 1024 px, two from 768 px and one on a phone, 16 to 20 px apart, in
  the order the principal asks:
  what must I do (Actions), who do I chase (Waiting on), what moved (Attention KPIs), then the
  committees carrying work, the initiatives slipping, and last their own recent notes, which are
  reference rather than a state to read and are drawn quieter for it. When the Actions tile carries
  more than four rows and at least three tiles follow it, it runs down two rows of the grid from
  1024 px and the tiles beside it stack, so the longest list sets the height rather than leaving a
  hole under the shorter ones; tiles in one grid row share a height, the way widgets do. Overdue is the only state that
  uses the danger token, and only above zero — and only on the summaries: the strip's overdue
  column, the ledger entry, the Actions header count and the band label. A row's own lateness ("143
  days late") is a figure in muted ink; it ranks the rows under a band that has already been read as
  late, and drawn red as well it stopped ranking anything.
  *Changed 2026-10-18, round 2:* the date line names the weekday ("Sunday, Oct 18, 2026"). The headline names exactly what it counts, joined as a list: tasks due today, overdue tasks, KPIs needing attention and initiatives at risk ("6 overdue tasks and 3 KPIs need your attention."). Each count is a link into that work and is set in the accent, which follows the wallpaper. It is 22 px Light, the page's one memorable element. The Actions tile is the real work, so it comes first in the reading order at every width: from 1024 px it fills the first of three equal columns beside every row, with the week across the other two and the other tiles two to a row under it. Below 1024 px, Actions comes first, then the week. Tiles in a row share a height, Actions matches the rows beside it, and an odd last tile widens to close its row, so tops and bottoms line up (HOME-B15). The two-row span by row count is replaced by this layout.
- HOME-B11 *Removed 2026-10-18 at the owner's request.* The page carried one line into the people
  directory with the headcount (before that, a panel of its own). Home now carries no way into the
  directory; People is reached from the side menu. The payload's `peopleCount` is no longer drawn.
- HOME-B09 Sections that aggregate say how the pile is shaped, not only how big it is. The overdue
  section reports how much of it is a month or more past due, which separates a backlog from a mess,
  and each committee row shows how far along it is as a fixed-width meter with its fraction beside it,
  the same compact form the rest of the row's facts use. Marks are one accent fill over a neutral
  track, measured rather than chosen: accent against danger is indistinguishable under protanopia in
  the light theme, warning against danger fails even for normal vision, and a mid-grey against danger
  fails in the dark theme, so none of those may carry meaning. The track falls under 3:1 against the
  surface, so every meter ships with its figures in text and is hidden from assistive technology; the
  numbers inform and the mark only paces them. A section with nothing aged shows no mark at all,
  because an undivided bar carries no information. Both marks are neutral mass plus a danger portion: accent against danger is
  indistinguishable under protanopia in the light theme and warning against danger is indistinguishable
  even with normal vision, so neither may carry meaning. The neutral falls under 3:1 against the
  surface, so every mark ships with its figures in text and is hidden from assistive technology; the
  numbers carry the information and the mark only ranks it.
  *Changed 2026-10-18, round 2:* the bars beside late shares had no scale, so they are dropped and the figure stands alone. The ageing split is a muted suffix on the overdue band's head, not a danger phrase with a bar.
- HOME-B10 Waiting on is a chase list, not a task list: one row per person holding the principal's
  work, the heaviest holders first, each opening that person's waiting tasks. Who to chase is the
  action; which individual task they hold is detail that belongs on the task list. Each row is dated
  by the earliest due date among what that person holds, which is what decides between two holders
  with the same count; a holder whose items carry no due date has no such fact. A row also says how
  much of what its holder has is already late, in the same figure-and-mark form a committee's late
  share takes (HOME-B09), and only above zero. The count a holder carries sits at the row's end edge,
  where a committee's fraction sits, so the primary fact of a chase-list row has one position. Waiting work that nobody holds is still waiting: it is
  counted with the rest and reported as one last row, "No one assigned", with its count, its late
  share and its earliest due date, opening the waiting view unfiltered. The row arrives untitled with
  the key `unassigned` and the page names it in the reader's language and gives it an empty face in
  the avatar's slot so the titles stay in one column.
  *Changed 2026-10-18, round 2:* a holder's row is two lines: the name, then what they hold, how much of it is late, and how long the oldest has been late ("34 days late") in place of a past due date. While nothing is late yet, the first due date is the fact. The count no longer sits at the row's end.
- HOME-B14 The week block: the page's lead tile is the week ahead, drawn as a timeline. What is already overdue stands first and today and the six days after it run after it as columns, set apart by even spacing alone, each nothing but its date and, in words, how much top-level open work falls due on it. The date is a label: the weekday over the day's number, centred in the column the
  way a calendar's week row sets them, today's column the only one given a ground: a calm filled pill in the accent's soft wash with its number in the accent. *Changed 2026-10-18 at the owner's request:* the hairline beside the overdue column crowded today's pill and was dropped for spacing, and the solid accent circle round today's number became the soft pill. Every column is at least 44 px tall. The count is set in the text colour
  when a day carries work and left muted when it does not, so the eye lands on the days that matter;
  no other mark carries the day's weight. When the heading has already said nothing is due, the
  cells fall silent — a date and no count — because seven cells saying "none" say it seven more
  times; the counts return with the first task. Each day opens the task list narrowed to that day through
  the `href` the tasks provider gives it (`tasks?view=all&due=<date>`, TASKS-B05), so the strip is
  somewhere to go from, not only something to read; the page composes no URL of its own (HOME-B03). Two drafts were rejected on the way here: day numbers set
  like headlines read as a scorecard rather than a calendar, and one mark per task under each date
  said the count twice. The overdue column carries its label and count, borrows the danger token
  only above zero, opens the overdue view, and leaves the ageing split to the Actions band below,
  where there is room for the sentence (HOME-B09); the heading sums the seven days. The shape rides
  the due-today section as `days`, one entry per calendar day from the workspace's today, the way
  the ageing split rides the overdue section: both say what a pile looks like, not only how big it
  is, and the tasks provider supplies it inside its single query (HOME-B03). A strip without an
  overdue column, because that section is not installed, is seven columns rather than eight with a
  gap. When the meetings module ships, its day list joins this block beside the strip; until then
  the block is the part of the day view the tasks module can feed.
  *Changed 2026-10-18, round 2, at the owner's request:* the overdue count is no longer a cell in the row of days, where it read as one more day. It is a small danger-toned capsule in the tile's head ("6 overdue") that opens the overdue view. The row is seven even columns of the days, centred in their equal columns in both languages. When nothing falls due all week, the strip collapses to the tile's head: one line, with the capsule still shown when anything is late. "Open the week" and "View all" keep 12 px text but take a hit area of at least 24 px, or 44 px under a coarse pointer (`.home-hit`).
- HOME-B08 A task the principal can finish is finished here. Overdue and due-today rows carry the
  same completion control as the task lists, including the confirmation when the task still has open
  subtasks, so the page is somewhere work gets done rather than only a set of links out. Completion
  refreshes the page's own counts, and a count that changes is replaced rather than swapped in
  silence, so the effect of finishing something is visible where it is stated. Rows the principal cannot act on directly carry no control.
- HOME-B03 One aggregated endpoint `GET /home` returns all sections in one round trip; each module exposes a `homeSummary(ctx)` function through its `server` manifest that runs ≤ 2 queries. Every section and item carries its own `href`; the page never composes module URLs.
- HOME-B04 Refetch on focus and every 60 seconds.
- HOME-B05 The line under the headline is a ledger of the page: each installed section's count in
  section order, each a link into its section, so the page can be read in one breath and, on a
  phone, above the fold. *Changed 2026-10-18:* it is set as one sentence at body size (15 px Light,
  muted, the figures in full ink), the entries joined the way the reader's language joins a list
  (`Intl.ListFormat`, conjunction) and closed with a full stop — "6 overdue, 6 waiting on others,
  3 KPIs need attention, and no committee with open work." The middle dots it replaced read as a
  row of tokens. Zero is stated rather than dropped, quieter; only the overdue entry takes the
  danger ink, and only above zero. It replaced a greeting by name, which repeated what the rail
  foot already says in a heavier weight. *Removed 2026-10-18 at the owner's request:* the
  "Preparing for <principal>" line is no longer shown anywhere on the page.
  *Changed 2026-10-18, round 2:* the ledger sentence under the headline is removed: it repeated the tiles' counts. Its job, each count a way into that work, moved into the headline (HOME-B07).
- HOME-B12 The page arrives in the order it is meant to be read: the day, then the lead block, then
  the sections under it, with reference material settling last. Each block rises a short distance as
  it fades in and the lead's own rows follow it one after another, so the first read of a dense
  screen is paced rather than dumped. Only the lead's rows cascade; doing it in every section turns
  the page into a ticker. The aggregate marks draw themselves from the edge the reader starts at,
  which is the same statement the meter already makes, made once on arrival. The motion is
  decoration over a page that is already correct: under `prefers-reduced-motion: reduce` none of it
  runs and every block is at its resting position and full opacity on the first frame.
  *Changed 2026-10-18, round 2:* the page has one entrance and only one. The headline settles in with a short rise out of a soft blur (`.home-headline`), and nothing else moves on arrival: the tile cascade, the strip's cascade and the meters drawing themselves are removed. It does not run under reduced motion.
- HOME-B13 A section never runs past the end of the screen. A grid item does not shrink below its
  own min-content and a committee named after a UUID has no break in it, so on a phone — where the
  columns are one implicit track rather than the `minmax(0, …)` template of 1024 px and up — the
  column grew past its track and carried every section's "View all" off the end with it. The
  columns declare their own zero minimum, and the facts under a row truncate rather than push. The
  spacing between sections steps down below 1024 px for the same reason the entity bar's does
  (EP-B40): a 40 px gap between blocks is a row of records on a screen that has ten of them.
- HOME-B15 *Added 2026-10-18.* Home is built from the same material as the list pages. The page sits
  on their see-through canvas (the page card keeps only a light tint and a soft blur, so the
  wallpaper shows), and every block — the week and each section — is one widget tile of the glass
  the list cards and KPI tiles are drawn in (`.entity-glass`): 16 px corners, one inset, one head
  (an 18 px Medium heading, its count, "View all" at the end edge), no rule under the head, and
  hairlines only between the rows of one tile. A tile is not a control, so it does not brighten under
  the pointer; its rows and links do. No colour is added: the accent is the token, which follows the
  wallpaper. The skeleton draws the same tiles, and the empty state (no module installed) is one tile.
  *Changed 2026-10-18, round 2:* every tile shares one grid and one gap (20 px), one inset (20 px) and one 28 px head, so heading baselines align across a row. The tiles' outer edges line up with the headline's start edge. Rows lead with their check or face in one column across tiles. Weights step down: tile headings Regular, row secondary lines Light, the headline Light with its counts Regular. In Arabic everything aligns to the reading start (the right), using logical properties only; the day cells alone are centred, in their equal columns. Hover is the shared one: a tile is not a control and carries `.glass-static`, so the glass card hover never lights it, and its rows take the panel-row wash (`--nav-hover`, 150 ms), the same as the views rail and menu rows.
  On a desktop window from 1280×800 up, the page ends inside the page card without scrolling, so a trackpad
  never moves it; where it is longer (a phone, a short window) it scrolls with no visible scrollbar and no elastic bounce.
- HOME-B16 *Added 2026-10-18.* One quick capture: an "Add task" capsule at the end edge of the headline opens the task list's own create sheet (`tasks?new=1`), the same primary button and the same sheet as the list page. Completing a task from Home reports itself with the shared Undo toast (TASKS-B02), and undoing refreshes the page's counts.
- HOME-B06 Section ownership is exclusive and checked centrally when the providers are collected: a key claimed by two modules, or a key no section list declares, fails the request with the owning key named. Collapsing to the first match would make the page depend on module import order and let a section disappear silently.

## Known gap

The two sections an executive orients a day around, **Next meetings** and **Prep not ready**, have no
provider: the meetings module does not exist yet, so HOME-B02 omits them and the page cannot yet answer
"where am I today and am I ready". The week block (HOME-B14) is the part of the day view the tasks
module can feed on its own — what is late and how the next seven days are loaded — and it is where the
meetings list lands when that module ships. Until then the block is a strip rather than a day.

## Acceptance criteria

- HOME-A01 With seed data, Home shows the today meeting with its prep status, overdue actions, and the at-risk initiative; every "View all" opens the module in the matching view. (en, ar)
- HOME-A02 `GET /home` completes in ≤ 12 queries with seed data. (en)
- HOME-A03 With AI disabled the Pending AI reviews section is absent. (en)
- HOME-A04 A committee carrying an open task appears under Committees with open work, and its "View all"
  opens Committees in the open view. (en, ar)
- HOME-A05 An overdue row states how many days late it is, a waiting row names the person holding it, and a
  committee row states how much open work it carries. (en, ar)
- HOME-A06 Completing a due-today row from Home removes it and lowers the day's count without a reload. (en)
- HOME-A07 Waiting on shows one row per holder with their count, and a committee carrying late work shows that share. (en, ar)
- HOME-A08 With one task due today, two due in two days and one due in nine, the week block shows seven
  cells from today with counts 1, 0, 2, 0, 0, 0, 0, and an overdue cell carrying the overdue count. (en, ar)

## Required scenarios

- api: `/home` shape; query counter; disabled modules; duplicate and unknown section ownership (B06); the
  week's seven days and their counts (B14); the earliest due date, late share and unassigned row (B10).
- ui: no tile for an empty section and the one quiet line (B02); the headline's counted parts and their links (B07); the weekday in the date line (B07); Actions first (B07); the overdue capsule outside the days and the collapsed week (B14); the KPI reason chip and no ring (B01); titles clamp rather than truncate (B01); the waiting row's late age (B10); one entrance only (B12); quick capture (B16); text aligned to the start (B15); one glass tile per block on the see-through canvas (B15); the Actions tile's two-row span
  (B07); the headline agrees with the ledger (B07); no directory link (B11, removed); no "Preparing
  for" line (B05); omission of uninstalled sections; zero-item sections kept; empty state; links; headline states the day
  and not the deficit; the week leads (B07, B14); the strip's cells, today mark and overdue cell (B14);
  the merged Actions block and its bands (B01); the grid order (B07); per-section status fact; the KPI
  row's arc, share and state (B01); completion control only on task rows; chase-list aggregation with
  the late share, the earliest due date and the unassigned row (B10); ageing split; skeleton holds the
  layout; the entrance cascade reaches the lead, the grid and the marks (B12).
- e2e `home.spec.ts`: A01–A03.
- Mutation targets: `homeSummary` aggregators for tasks and meetings.
