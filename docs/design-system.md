# Enan design system

**Status:** current (2026-10-18). The single reference for how Enan looks and behaves. The decisions behind it are recorded in ADR 0030 (visual identity), ADR 0031 (Apple's dark materials) and ADR 0032 (Inter and Noto Sans Arabic); `05-ui-guidelines.md` holds the engineering rules (primitives, data fetching, i18n, accessibility). Where this document and a feature spec disagree about behaviour, the spec wins; about appearance, this document wins.

Every value below is a token in `src/ui/tokens.css` or a shared component. A component never names a colour, a pixel size between Tailwind's steps, or a radius of its own: it uses the token or the component.

## 1. Principles

1. **Apple's materials, not a template.** The night theme follows macOS's dark materials: a photographic wallpaper (ADR 0037 retired the drawn indigo), neutral grey frosted glass, white text at strengths, the system blue for actions and selection, the system hues for meaning.
2. **One material family.** The menu, the page, the record sheet, Spotlight and the review sheet are all the same frosted glass. Content inside them sits on solid inset sheets, never glass on glass.
3. **Structure is felt, not drawn.** Sections are separated by space and a quiet heading. Rules (lines) appear only between the rows of one sheet, never between sections and never under a bar at rest.
4. **Weight carries hierarchy.** Light for what supports, Regular for what reads, Medium for names, Semibold for titles. Colour is for meaning, not decoration.
5. **One way to do each thing.** One button family, one property sheet, one record title, one way to show selection, one date format.
6. **Bilingual by construction.** Every rule holds in Arabic and English, right to left and left to right. Arabic is checked first.

## 2. Foundations

### 2.1 Themes and materials

The night theme is the default. Paper (light) shares every role; its values differ.

| Material | Where | Night value |
|---|---|---|
| Wallpaper | The window background (`html.dark`, `data-wallpaper`) | Chosen by an administrator (ADMIN-B42): a photograph from `public/wallpapers/` covering the window (Ribbon, Copper, Jade, Neon, Folds, Stone, Arc, Sky; Jade is the default and the fallback `--wallpaper` over `#0a0f0b`; Ribbon is drawn larger so its sweep crosses behind the menus), or an image the administrator uploaded (ADMIN-B47, `data-wallpaper='custom'` with its address in `--wallpaper-image`). `data-wallpaper-tone` is `light` only for an upload measured light; the list side then takes the menu's frost. |
| Glass | Menu, page card, record sheet, Spotlight, review sheet | Grey frost `rgb(36 36 40 / 0.7)` (`--surface`, `--canvas`), `backdrop-filter: blur(64–72px) saturate(120–170%)`, a faint grain (`--frost-grain`), a lit top edge |
| Inset sheet | Property sheets, card rows, lists inside a record | `bg-bg/50` with a full `border`, `rounded-xl` |
| Glass card | Every list's cards, the KPI tiles and the Home tiles (`.entity-glass`; HOME-B15). A glass surface that is not itself a control (a Home tile, whose rows are the controls) adds `.glass-static` and does not react to hover; its rows take the `--nav-hover` wash | Flat, with no depth effects: a light neutral frosted tint `rgb(255 255 255 / 0.045)`, the frost grain and a hairline edge. No sheen, rim, shadow, lift or sweep. Hover brightens the tint and edge only. On a KPI tile the status is a faint wash on the arc's side and a dim light behind the arc, kept inside the tile. |
| Table frame | The table view of a list (`.entity-table-frame`) | The same frosted glass as the cards, as one rounded panel inset from the page's edges; it scrolls sideways inside itself, and only the row under the pointer changes on hover. |
| Sign-in panel | `/login`, `/setup`, `/recovery` (`.auth-glass`) | The side menu's own frost, value for value, as one 400 px panel centred over the workspace wallpaper (20 px corners, 16 px gutters on a phone). The ع-horse mark in its accent tile and "Enan" head the panel; the language flags sit in the top corner on the end side. A custom wallpaper cannot be served before sign-in, so these pages fall back to the drawn wallpaper when one is chosen. |
| Raised step | Selected pills, chips, hover wash | White at 8 % (`--raised`) |
| Elevated | Solid fallback for sheets and popups | `#232326` (`--elevated`) |

Rules:

- `backdrop-filter` is written once, unprefixed; the build adds Safari's prefix. Writing both made Chrome drop it.
- A blur inside an element that already has a backdrop blur does not take effect. A frosted layer inside glass is drawn on a pseudo-element of the outer element (`.app-canvas::before`) or is solid (`--sheet-top`).
- Under `prefers-reduced-transparency: reduce` every material falls back to solid: no wallpaper, no blur, no grain.

### 2.2 Colour

| Role | Token | Night | Use |
|---|---|---|---|
| Text | `--text` | white 96 % | Body, values, names |
| Secondary text | `--muted-text` | `rgb(235 235 245 / 0.8)` | Labels, metadata |
| Tertiary text | `--faint-text` | `rgb(235 235 245 / 0.72)` | Hints, placeholders, unselected suggestions |
| Edge | `--border` | white 14 % | Sheet borders, row dividers (at 70 %) |
| Primary | `--primary` | `#0071e3` (Apple blue) | The primary button, checkboxes, selection |
| Accent | `--accent` (with `--accent-soft`, `--on-accent`) | Follows the wallpaper (ADR 0037): Jade `#b5c59b`, Neon `#90cace`, Sky `#98c3e9`; Ribbon, Copper, Folds, Stone and Arc, and an image with no usable colour, keep the sage `#9ad8b4` (ADR 0036). Paper: Jade `#4e5b35`, Neon `#255f63`, Sky `#3f6789`, sage `#2e6b54`. Each clears 4.5:1 on the night inset sheet and canvas and on the paper ground and surface | The brand mark, current item's icon, links, counts in the views rail |
| Danger | `--danger` | `#ffa8a1` (mark `#ff453a`) | Overdue, destructive actions |
| Warning | `--warning` | `#ffc670` (mark `#ff9f0a`) | High priority |
| Success | `--success` | `#7aeba2` (mark `#30d158`) | On target, completed |

Rules:

- **Blue means action or selection.** The primary button, ticked checkboxes, a selected suggestion's tint, a selected tag's fill, the frame of proposed AI content.
- **Accent marks place.** The current menu item's icon, links, counts. It is never a fill behind text and never a tag colour.
- **Chips are neutral.** Tags and status labels are grey capsules. Colour on a chip means a state (late, archived), never decoration.
- **Contrast is measured at the worst point.** Text over glass clears 4.5:1 at the wallpaper's brightest band, unblurred. Marks (dots, arcs) use the system hue at 3:1; the word beside them uses the lighter ink step.

### 2.3 Typography

**Faces.** Inter for Latin, Noto Sans Arabic for Arabic, on every device, through `next/font`. Every stack is `'Inter', var(--font-arabic), sans-serif`: Inter has no Arabic glyphs, so Arabic falls through to Noto and Latin stays in Inter. Inter is named without next/font's Arial-based fallback, which covers Arabic and would catch it first. Titles use the same stack (`font-display`).

**Scale.** Named steps live in `tokens.css` and are known to `cn()`:

| Token | Size | Use |
|---|---|---|
| `text-xs` | 12 px | Metadata, chips, footer |
| `text-meta` | 13 px | Property labels, list bar controls, views menu |
| `text-sm` | 14 px | Body, values, section headings |
| `text-nav` | 15 px | Card titles; Arabic navigation labels |
| `text-heading` | 18 px | Group headings ("Overdue"), Home tile headings |
| `text-xl` (page title) | 20 px | Page title in the header |
| `text-title` | 22 px | A record's title (task, note, committee, person) |
| `text-display` | 36 px | Not in use: the Home headline is set at `text-title`, 22 px Light (HOME-B07) |

**Weights.**

| Weight | Use |
|---|---|
| Extra Light 200 | Card excerpts; no headline uses it (the Home headline is 22 px Light, HOME-B07) |
| Light 300 | Descriptions, excerpts, secondary lines, the views menu, list bar controls, dropdown items, search field |
| Regular 400 | Body, values, group headings |
| Medium 500 | Names (task, note, committee), section headings, menu items |
| Semibold 600 | Page titles, record titles, Spotlight group heads |

**Dates.** One format everywhere, from `usePlainDate()` (`Sep 14, 2026`, `14 سبتمبر 2026`) or the relative helpers. A raw ISO date is never shown.

### 2.4 Shape

| Element | Shape |
|---|---|
| Every button | Capsule (`rounded-full`) |
| Search field, segmented controls, sort trigger in the list bar | Capsule |
| Chips and tags | Capsule |
| Progress bars and meters (track and fill) | Capsule, round ends |
| Icon buttons | Circle, 32 px (`size-8 min-h-0`) |
| Inset sheets, cards | 12 px (`rounded-xl`) |
| Views rail panel | 16 px |
| Menu, page card, record sheet | 20 px |
| Spotlight, review sheet | 22 px |
| Selected items in a menu | Rounded rectangle, concentric with the panel (12 px in a 20 px panel, 8 px in a 16 px panel), never a capsule: a capsule means "press", a rectangle means "you are here" |

### 2.5 Spacing and density

- 4/8 px grid. Inside a record, sections are 32 px apart (`mt-8`); the footer sits 40 px under the last section (`mt-10`).
- Rows: list cards have a 56 px opening target; property rows are 44 px; menu rows 44 px; views rail rows 36 px.
- Controls are 36 px with a pointer and 44 px on touch; the list bar's controls are a compact 32 px with a pointer.

### 2.6 Motion

- One easing (`--ease-rise`) and one cascade step (`--step-rise`).
- Hover feedback: a card rises 1 px with a soft shadow in 160 ms; a pressed primary button scales to 98 %.
- Sheets fade and slide in; the backdrop behind them fades in.
- Everything respects `prefers-reduced-motion`.

## 3. Layout

### 3.1 Shell

From 1024 px the window holds two floating glass panels inset 8 px from its edges: the **menu** and the **page card**. In Arabic the menu is on the right.

- **Menu:** the brand mark in a tinted square with the name; destinations as 44 px rows in Light, the current one Regular on a white wash with its icon in the accent. Nothing at the foot: Administration is in the account menu.
- **Header** (top of the page card): the page title (20 px Semibold) and the views-rail toggle at the leading edge; search (⌘K / Ctrl K), the language flags (UK / Saudi), notifications and the account at the end. On a phone the title stays in the page.
- **Phone:** a floating rounded glass bar (28 px corners, inset 12 px, above the safe area) with four destinations and More; the page reserves its height so nothing scrolls under it.

### 3.2 List pages

- **Views rail:** a 208 px inset panel (16 px corners) inside the page card: the primary Create capsule, then the views as 36 px rows with Light labels, the current one a raised pill.
- **List bar:** search, sort, card or table, select and Filter, all capsules at 32 px with Light text. It has no background at rest; content scrolling under it is softly blurred.
- **Cards:** inset sheets built from the shared card pieces in `src/ui/entity/Card.tsx`, so every list's cards change together. A card carries the title (`CardTitle`, `text-nav`, Medium), at most one Light line (`CardExcerpt`), and an icon facts line (`CardFacts`, `CardFact`). Chips (`Chip`) and faces sit in the trail at the end. A person's card adds a neutral initials circle before the name. Cards that carry tasks use `CardWorkload` for the open, late and due-today counts, so a person and a committee say them in the same words. `CardProgress` is the done-of-total bar in the trail of a note or a committee. A card never repeats what the view or the group heading already says, such as a status dot in the Active view. The whole card is one surface: it tints and rises on hover as one.
- **Group headings:** 18 px, coloured only when the group means something (Overdue in danger, Today in accent).
- **Table:** dense rows for scanning; the same records and keyboard.

## 4. Components

### 4.1 Buttons

| Kind | Look | Use |
|---|---|---|
| Primary | Blue capsule, white Regular text; darkens on hover and press, scales to 98 % on press | The one main action of a view: Add, Create, Apply, Review |
| Secondary | Grey capsule (`variant="secondary"`) | A second action beside the primary (Discard, Regenerate), Link task, Archive |
| Quiet | No fill (`variant="ghost"`) | Small in-row actions |
| Destructive | Red text, soft red tint on hover | Move to trash; filled red only for irreversible actions behind a confirmation |
| Icon | 32 px grey circle (`variant="secondary" size="icon-sm"`, `size-8 min-h-0`) | AI actions (wand), expand, close |

A pair of actions sits together at the trailing end, the primary last. A button that cannot do anything is not shown; offer the action that can (a stale AI suggestion offers a new draft, not a disabled Apply).

### 4.2 Segmented controls

A capsule track (`bg-surface-raised`, `rounded-full`, 2 px padding) with Light options; the selected option is a raised pill (`bg-surface`, Medium, a small shadow). In the night theme the control is flat, like the language toggle in the header: a plain track (a hairline border over `surface/40`), the selected option a flat white wash (`white/15`) with full-ink text and the others muted, with no shadow, rim or inner highlight; the night theme draws nothing as raised. Tabs that mark the chosen option with `data-active`, and the card or table icon toggle, use the same wash. Every segmented toggle is sized to its options (`h-8` segments, `text-sm`) and set at the start edge of its row, the right in Arabic; the list's mode header (`EntityModeHeader`) included. It is `Segmented` in `src/ui/primitives/segmented.tsx`, whose segments are toggle buttons with `aria-pressed`. Used for: a person's type (internal or external), the review's view switch, a committee's linked work, card or table. Prefer it over a menu when there are two to four values worth seeing side by side.

### 4.3 Chips and tags

- Neutral grey capsule, 12 px text.
- A removable tag carries its × inside the capsule, at its end; the × turns red on hover.
- Every record edits tags with the one shared field, `TagsEditor` in `src/ui/tags/`: chips, then an input whose list offers the tags already used in that module, an "Add" row for a new name, and a limit of ten. Each module passes its own suggestions.
- A suggested tag: unselected is an outlined faint capsule with a +; selected is a solid blue capsule with white text and a ✓.

### 4.4 Selection

Blue is the colour of "chosen".

- **Checkboxes:** blue when ticked.
- **Suggested items:**
  - Selected: a blue-tinted row with full ink.
  - Unselected: half strength.
- **Select all:** covers every kind of suggestion together (tasks and tags) and shows a partial state.

### 4.5 Dropdowns and menus

Popups are light glass (blur 28 px). Their items are Light. The current choice carries a tick.

### 4.5b Toasts

- Every module raises the one shared toast (a task done, an order saved, a record in Trash).
- In the night theme it is liquid glass in a capsule: a clear tint, a heavy saturated blur of what is behind it, a sheen, the grain, a bright top rim and a deep shadow. It can blur because it floats in its own layer, outside the page card.
- One action or a dismiss, never both.

### 4.5c Reordering

- A list the reader orders by hand gives each row two small move buttons in its end corner: one place earlier, one place later. The arrows mirror in Arabic.
- The buttons show on hover or focus and always on touch. At a group's ends the button that would leave the group is disabled.
- Rows glide to their new places, and a toast confirms the order was saved, or says it was not and the rows went back.
- The shared pieces are `useListReorder` and `EntityRowGrip` in `src/ui/entity/`.

### 4.6 Sheets and dialogs

- **Record sheet** (opening a row, from 1024 px): a floating glass sheet inset 8 px from the window, 20 px corners, the whole window blurred and slightly dimmed behind it (clicks still reach the list). One exit: × at the end edge on desktop, Back at the start edge on a phone. No previous or next, no position counter. The top bar is clear at rest; once content scrolls under it, it takes the sheet's tone with a soft shadow, and the record's name appears. No visible scrollbar.
- **Expanded field and AI review:** a 22 px glass sheet, no rules between header, body and actions, no visible scrollbar.
- **Spotlight** (⌘K / Ctrl K): a 680 px glass panel in the upper fifth of the screen over a blurred page; a 20 px Medium field; ruled sentence-case group heads; the selected result a soft fill inside a fine rim; matching words in Semibold, whole words only so Arabic joining never breaks.

## 5. Record patterns

Every record (task, note, committee, person) is built from the same pieces (`src/ui/layout/Record.tsx`, `Property.tsx`):

1. **Title:** the record's name is its heading and is edited in place (`RecordTitleField`, or `RecordTitleInput` for a form-bound record), 22 px Semibold with a hairline only under the pointer. Enter commits. The name never appears a second time as a property row. A person's title sits beside a 56 px neutral avatar. `RecordTitle` is the read-only heading for a record in the trash.
2. **Property sheet:** `PropertySheet` holding `Property` and `Field row` rows: label (13 px, secondary) in a 6.5 rem leading column, value beside it. Values show their control only on hover or focus. An empty value shows a faint "Add…" with no outline until pointed at. Values sit on the start edge whatever script they are typed in.
3. **Sections:** `RecordSection`, a 14 px Medium heading with an optional count and action, then the content. A section's items sit on `RecordList`, the same inset sheet. Long text (a description, a person's notes, a note's content) is the markdown field with its label above, the same in every record. A section's way to the full list is `RecordMore`, a small grey capsule button, never a bare text link.
4. **Related work:** a segmented control to switch between kinds (tasks, notes, activity) or one section per kind.
5. **Footer:** freshness at the start ("Updated 3 weeks ago"), the record's own secondary actions and Move to trash at the end. It never repeats a property shown above.

AI inside a record:

- The wand is a 32 px grey circle beside the property it acts on.
- Suggested subtasks are faint until ticked.
- Proposed content is labelled "Suggested" and its own frame takes the blue tint and edge, while the original stays neutral.

## 6. Accessibility

- Text clears 4.5:1 and marks 3:1, measured over the brightest part of the wallpaper.
- Touch targets are 44 px. Every icon button has an accessible name.
- Focus is always visible. Colour never carries meaning alone: priority is a dot and a word, selection is a tick and a tint.
- Reduced motion and reduced transparency are honoured everywhere.
- RTL is checked first: logical properties only; numbers and dates are isolated so they never jump sides.

## 7. Don't

- Don't draw a rule between sections or under a bar at rest.
- Don't put glass on glass. Content inside glass is a solid inset sheet.
- Don't use the accent as a fill, a tag colour or a button colour.
- Don't use uppercase tracked labels.
- Don't write a pixel size, colour or radius in a component; add a token.
- Don't show a control that does nothing (a disabled Apply, a More toggle on short text, an empty list frame).
- Don't show two exits that do the same thing.

## 8. Where it lives

| Concern | File |
|---|---|
| Tokens, materials, glass, motion | `src/ui/tokens.css` |
| Class merging with the named steps | `src/ui/cn.ts` |
| Buttons | `src/ui/primitives/button.tsx` |
| Property rows and sheet | `src/ui/layout/Property.tsx`, `src/ui/layout/Field.tsx` |
| Record title, section, list, view-all button | `src/ui/layout/Record.tsx`, `RecordTitleField.tsx` |
| List cards | `src/ui/entity/Card.tsx` |
| Tags field | `src/ui/tags/TagsEditor.tsx` |
| Segmented control | `src/ui/primitives/segmented.tsx` |
| Shell, menu, header | `src/ui/layout/AppShell.tsx`, `ShellLinks.tsx`, `ShellHeader.tsx` |
| Spotlight | `src/ui/layout/SearchPalette.tsx`, `search-hit.tsx` |
| List framework | `src/ui/entity/` |
| Expanded field and review sheet | `src/ui/markdown/ExpandedField.tsx` |
| Fonts | `src/app/layout.tsx` |

**Applied:** shell, Home, Tasks, Notes, Committees, People, KPIs, Spotlight, Administration (its menu is the glass views rail, its pages use the record title, inset sheets, property-sheet rows and capsule buttons).
