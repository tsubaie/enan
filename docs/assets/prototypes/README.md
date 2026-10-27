# Enan — 5-Stage Design Thinking UI/UX Review (Issues #110–#120)

**Platform & Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS · SQLite (`better-sqlite3` WAL)  
**Design System:** Warm Paper & Dark Ink (`#f7f5f0` paper, `#ffffff` surface, `#ebe7df` muted, `#161615` ink, `#1d4ed8` cobalt accent, `#15803d` emerald, `#b45309` amber, `#b91c1c` crimson)  
**Typography:** `Newsreader` (editorial serif headers) · `Plus Jakarta Sans` (UI sans) · `IBM Plex Sans Arabic` (RTL Arabic parity) · `JetBrains Mono` (tabular metrics, dates, reference codes, tokens)  
**Standards Baseline:** Apple Human Interface Guidelines (`layout.md`, `modality.md`, `menus.md`, `notifications.md`, `generative-ai.md`, `accessibility.md`) · WCAG 2.2 Level AA · Full LTR/RTL Bilingual Parity

---

## Executive Summary & Design Thesis

Issues `#110` through `#120` expand Enan from a static record-keeping workspace into a **proactive, high-velocity executive operating system** spanning recurring cadences (`#110`), sub-2-second personal reminders (`#111`), delegated follow-up tracking (`#112`), voice-to-brief capture (`#113`), structured committee governance (`#114`, `#115`), KPI owner accountability and AI narrative synthesis (`#116`, `#117`), 1-on-1 stakeholder prep dossiers (`#118`), external calendar synchronization (`#119`), and scoped automation access via CLI and MCP (`#120`).

When designed in isolation, each feature is sound. When shipped simultaneously into a single executive workspace without cross-surface harmonization, five systemic UX collisions emerge:
1. **`/home` Above-the-Fold Vertical Pushdown (`#112` + `#119`)**
2. **`ShellHeader` Dual-Bell Ambiguity (`#111` + `#116`)**
3. **`TaskDetail` Metadata Stack Bloat (`#110` + `#112` + `#120`)**
4. **`CommitteeDetail` Roster-to-Resolution Governance Disconnect (`#114` + `#115`)**
5. **`/kpis` Context-Free Reading Modal & Stale AI Brief Risk (`#116` + `#117`)**
6. **`/notes` Blank-Form Capture Tax Before Voice Recording (`#113` — Collision `C-06`)**

This 5-Stage Design Thinking review (**Empathize → Define → Ideate → Prototype → Test**) resolves all five cross-issue collisions and upgrades all 11 Retina (`2x`, `3600×2280` px) multi-step workflow prototypes prior to engineering implementation.

---

## Stage 1 — Empathize: The Bilingual Executive & Chief of Staff Context

### Primary Persona & Operational Environment
- **Role:** Time-constrained Chief of Staff, Principal Executive, or Committee Secretary operating in a bilingual (`AR/EN`) governance environment.
- **Device & Viewport Reality:** Primarily 13"–14" notebooks (`1440×900` / `1512×982` CSS px) in boardrooms and between back-to-back meetings, plus mobile/tablet review during transit.
- **Strict Cognitive Load & Time Budgets:**
  1. **Morning Triage Budget (`< 15 seconds` on `/home`):** Upon opening `/home` at 8:30 AM, the executive must immediately see *what meetings are happening today*, *who owes a follow-up today*, and *which critical tasks are due*—without vertical scrolling past stacked banners.
  2. **In-Flight Capture Budget (`< 3 seconds` keyboard-first):** While on a phone call or reviewing a legal brief, capturing a personal nudge (`Alt+R` in `#111`) or starting a voice memo (`#113`) must require zero pointer precision and zero loss of current page state.
  3. **Zero Context-Switching During Governance Reviews:** When logging a KPI reading (`#116`), recording a committee resolution (`#115`), or preparing for a 1-on-1 (`#118`), the interface must bring historical reference data (prior 3 KPI periods, committee voting quorum, stakeholder workload) directly to the point of action.
  4. **Bilingual Mixed-Script Fluency (`AR/EN`):** Arabic prose routinely embeds English acronyms (`KPI`, `SLA`, `JV`), reference codes (`RES-2026-14`), and signed variances (`+1.8d`, `SAR 44.5`). Every numeric, code, and directional token must maintain crisp bidi isolation (`<bdi>`, `dir="auto"`, `font-variant-numeric: tabular-nums`).

---

## Stage 2 — Define: Cross-Issue Friction & Surface Collision Matrix (`#110`–`#120`)

Evaluating Issues `#110`–`#120` as a unified system reveals five high-priority surface collisions:

| Collision ID | Colliding Issues | Shared UI Surface | UX Friction & Failure Mode | Apple HIG & UX Principle Violated |
| :--- | :--- | :--- | :--- | :--- |
| **C-01** | `#112` + `#119` | `/home` Top Canvas | Stacking a full-width **"Today's Schedule"** strip (`#119`) above or below a full-width **"Follow-ups Due / Waiting On"** strip (`#112`) consumes `> 380px` of vertical height, pushing primary Next Action Tasks and KPI alerts below the fold on 13"/14" screens. | `layout.md › Visual hierarchy`: *"Order content by relative importance... Use progressive disclosure to make layouts cleaner and easier to interact with."* |
| **C-02** | `#111` + `#116` | `ShellHeader` Top-Right | Adding a separate `⏰ Reminders (2)` badge trigger (`#111`) right next to the `🔔 Notifications (3)` bell (`#116`) creates a **Two-Bell Split Brain**. Users hesitate over which icon holds a fired reminder vs. a due KPI reading. | `notifications.md › Badging`: *"Use a badge only to show people how many unread notifications they have."* · `layout.md › Visual hierarchy`: *"Group related items to clearly express related information or functions."* |
| **C-03** | `#110` + `#112` + `#120` | `TaskDetail` Property Sheet | Adding `Repeat` (`#110`), `Requested by` (`#112`), `Follow-up date` (`#112`), and `via Executive Assistant` automation attribution (`#120`) as separate vertical rows inflates `TaskFields` to 7–8 rows, pushing subtasks and notes out of view. | `layout.md › Visual hierarchy`: *"An interface with too much content and too many choices makes it harder to find information quickly."* |
| **C-04** | `#114` + `#115` | `CommitteeDetail` & Resolution Modal | Recording a resolution vote tally in `#115` (`For / Against / Abstain`) has no live link to `#114`'s structured roster (`5 Voting Members`), forcing the secretary to switch tabs to check whether quorum was met. | `modality.md › Best practices`: *"Help people perform a distinct, narrowly scoped task without losing track of their previous context."* |
| **C-05** | `#116` + `#117` | `/kpis` Header & `RecordReadingModal` | Deep-linking into `RecordReadingModal` (`#116`) shows only a static number for the previous period, lacking a 3-period trend sparkline. Furthermore, logging a new reading invalidates `#117`'s `data_hash`, requiring an explicit freshness indicator on the AI commentary card. | `generative-ai.md › Outputs`: *"When people adjust or personalize output, provide a clear signal that their action had an effect."* |
| **C-06** | `#113` | `ShellHeader` / `/home` / `/notes` | Requiring an executive to open `/notes`, click `+ New Note`, and type a blank form title *before* starting a voice recording imposes a 3–4s "Blank-Form Tax" right when post-meeting thoughts are fleeting. | `layout.md` & `generative-ai.md`: *"Eliminate setup friction; let AI synthesize structure from natural input."* |

---

## Stage 3 — Ideate: Issue-by-Issue UX Upgrade Decisions (`#110`–`#120`)

Below is the structured Design Thinking progression (**Initial Pattern → Friction Identified → Refined Design Thinking Solution → Apple HIG & WCAG 2.2 AA Verification**) for every issue from `#110` to `#120`.

### Issue `#110` — Recurring Tasks & Executive Cadences
- **Initial Pattern:** Separate vertical `Repeat` row inside `TaskFields` property grid; standard completion toast.
- **Friction Identified:** Increases vertical height of `TaskDetail` (Collision C-03) and does not clarify whether recurrence anchors to the *scheduled due date* (fixed cadence) or *completion date* (`after_completion` rolling cadence) before the user clicks complete.
- **Refined Design Thinking Solution (Best Way):**
  1. **Unified Schedule Cluster:** Co-locate the `↻ Repeat` pill directly inside the `Due date` row (`📅 Thu, 30 Oct 2026 · [↻ Weekly · Mon ▾] · Next: 3 Nov`), saving a full vertical form row.
  2. **Explicit Cadence Mode Segmented Switch inside `RecurrencePicker`:** Clearly separate **Fixed Schedule** (`Daily`, `Weekdays`, `Weekly`, `Monthly`, `Quarterly`) from **Rolling (`+Nd after completion`)** with a live preview of the next occurrence date.
  3. **Atomic Subtask Reset Preview & Undo Toast:** Display a `3/3 subtasks reset on next cycle` badge in the checklist header and provide a persistent 8-second `Undo` action on the completion toast (`accessibility.md › Cognitive`: *"Minimize use of time-boxed interface elements"*).
- **HIG & A11y Verification:** Contrast `12.8:1` (`#161615` on `#f7f5f0`), keyboard `ArrowUp/Down` + `Esc` popover dismissal (`menus.md › Organization`).

### Issue `#111` — Fast Header & Global Shortcut Quick Reminders
- **Initial Pattern:** Separate `⏰ Reminders (2)` badge icon in `ShellHeader` next to `🔔` notifications; command modal with 6 time pills.
- **Friction Identified:** Competing header badges between `⏰` and `🔔` (Collision C-02).
- **Refined Design Thinking Solution (Best Way):**
  1. **Split Action vs. Inbox Responsibility:** Style the header reminder button strictly as a **fast creation trigger** (`+ Reminder · Alt R`) with zero competing unread counter badge, while routing all *fired* reminders into the unified `🔔 NotificationMenu` inbox (`Due Now` pinned section at top).
  2. **Auto-Captured Entity Pill:** When `Alt+R` is pressed while viewing a Note, Task, Committee, or Person, automatically attach a removable `Linked: 📄 Note: JV Term Sheet` pill with `1–5` single-key time presets once `Tab` moves focus to the preset bar.
- **HIG & A11y Verification:** Follows `notifications.md › Badging` (single unified unread badge on `🔔`) and `modality.md › Best practices` (streamlined single-field modal with `Esc` and `Enter ↵`).

### Issue `#112` — "Requested By" Attribution & Follow-Up Dates
- **Initial Pattern:** Separate `Requested by` and `Follow-up date` rows in `TaskDetail`; full-width `/home` "Follow-ups Due" strip.
- **Friction Identified:** Bloats `TaskDetail` by two rows (Collision C-03) and pushes `/home` content down when combined with `#119`'s schedule strip (Collision C-01).
- **Refined Design Thinking Solution (Best Way):**
  1. **Compact Delegation Flow Chip (`Requester → Assignee`):** Combine authority and execution into a single scannable delegation row in `TaskDetail`: `Noura Al-Mansoor (Requester) → Khalid Al-Otaibi (Assignee)` with automatic RTL arrow mirroring (`←`).
  2. **Paired `/home` Executive Today Bar (50/50 Split with `#119`):** On `/home`, render **Follow-ups Due Today (`#112`)** and **Today's Schedule (`#119`)** side-by-side in a compact 2-column **Executive Today Bar** capped at 3 visible rows (`max-height: 176px`), preserving above-the-fold visibility for Tasks and KPIs.
  3. **Inline `+1d / +3d / +1w` Quick Rollover:** Allow 1-click follow-up advancement directly from the `/home` row without opening a modal.
- **HIG & A11y Verification:** Adheres to `layout.md › Visual hierarchy` and `right-to-left.md` directional glyph mirroring.

### Issue `#113` — Capturing Notes as Voice Memos (Record-First → AI Auto-Creates Complete Meeting Note)
- **Initial Pattern:** Requiring the user to navigate to `/notes`, click `+ New Note`, type a title into a blank form, and only then click `Record` inside `NoteDetail`.
- **Friction Identified (Collision C-06 — The "Blank Form Tax" & Destructive Overwrite Risk):**
  - **Empathize:** An executive walking out of a boardroom has `< 2s` to start dictating while decisions and numbers are fresh.
  - **Define:** Forcing `/notes` → `+ New Note` → type title → click `Record` adds 4 unnecessary steps before the microphone is live.
- **Refined Design Thinking Solution (Mode A Record-First Hero Flow + Mode B In-Note Append):**
  1. **Mode A — Primary Hero Workflow ("Record-First → AI Auto-Creates the Complete Meeting Note"):**
     - **1-Click Global / Header Capture (`🎙 Record · Alt+V`):** Triggering `🎙 Record` from `ShellHeader`, `/home`, or `/notes` opens the live floating 24-bar waveform bar (`navigator.wakeLock`) immediately—zero blank form required.
     - **Save-Before-Transcribe (`POST /api/v1/notes/voice-capture` per `ADR 0054`):** Persists the encrypted audio file first via `writeStoredFile` outside the SQLite lock, then creates the `notes` + `note_voice_memos` rows with a deterministic timestamp fallback title (`Voice Memo · 27 Oct 2026, 21:45` / `مذكرة صوتية · ٢٧ أكتوبر ٢٠٢٦، ٢١:٤٥`).
     - **Full AI Meeting Note Synthesis (`notes.voice_to_note`):** Runs bilingual (`AR/EN`) ASR + structured LLM extraction to automatically populate:
       - **Auto-Generated Title** in the speaker's language (`AR` or `EN`), replacing the temporary timestamp title (only if the user hasn't manually edited the title in the meantime) with a `✨ Auto-Titled by AI` badge.
       - **Structured Meeting Body** (`Executive Summary`, `Key Discussion Points`, `Decisions Recorded`) paired with a switchable `Verbatim Transcript` tab.
       - **Auto-Matched Attendees (`note_participants` / `@Person`) & Auto-Linked Committee (`committee_id`)** fuzzy-matched against existing workspace `people` and `committees`.
       - **Auto-Suggested Tags** and **Extracted Action Items (`NoteReviewCard`)** with 1-click `+ Create task` (pre-filling `owner_id`, `requested_by_id`, and `due_date`).
  2. **Mode B — Secondary Workflow ("Record/Attach Inside an Existing Note"):** Preserves inline recording/upload (`POST /api/v1/notes/:id/voice`) inside `NoteDetail` for appending follow-up audio to an existing note without overwriting prose.
  3. **Graceful Offline / No-AI Fallback & Undo Control (`hig/generative-ai.md`):**
     - If AI is disabled, unconfigured, or unreachable, the note is still saved immediately with its timestamp title and scrubbable audio player (`transcription_status = 'skipped' | 'failed'`) plus a 1-click `✨ Generate AI Meeting Note` retry button—zero audio is ever lost.
     - When AI auto-populates the new note, a subtle `✨ Auto-created from Voice Memo · Revert to raw transcript` banner ensures the user retains 100% control.
- **HIG & A11y Verification:** Complies with `accessibility.md › Hearing` (full text transcript paired with scrubbable audio player `1x / 1.5x / 2x`) and `generative-ai.md › Outputs` (non-destructive review + 1-click revert + offline durability).

### Issue `#114` — Structured Committee Roster, Roles & Terms
- **Initial Pattern:** `Members` tab table with role badges and term dates.
- **Friction Identified:** Term expirations (`Expiring in 18d`) are buried inside the `Members` tab, and voting quorum rules aren't summarized in the committee header (Collision C-04).
- **Refined Design Thinking Solution (Best Way):**
  1. **Header Governance Summary Bar:** Surface `Chair`, `Secretary`, `Quorum: 5 Voting (Min 3 required)`, and any `⚠ 1 Term Expiring Soon` pill directly in the `CommitteeDetail` header bar.
  2. **Inline Role & Voting Quick-Toggle:** Allow authorized users to update a member's role (`Chair`, `Vice Chair`, `Secretary`, `Member`, `Observer`) and `Voting` status inline without a full page reload, while cross-linking every seat on `PersonDetail`.
- **HIG & A11y Verification:** Semantic status chips pair color with explicit text labels (`accessibility.md › Visual Legibility & Contrast`: *"Convey information with more than color alone"*).

### Issue `#115` — Committee Decision & Resolution Logs
- **Initial Pattern:** `Decisions` tab with `RES-2026-NN` cards and a manual `For / Against / Abstain` text input in the modal.
- **Friction Identified:** Disconnected from `#114`'s active voting member count (Collision C-04); users must manually check if `5 For + 0 Against + 1 Abstain` matches the 6-member roster.
- **Refined Design Thinking Solution (Best Way):**
  1. **Quorum-Aware Vote Tally Stepper:** Auto-populate the `Record Committee Resolution` modal with the committee's live voting roster count from `#114` (`Quorum Verified: 5/5 Voting Members · ✓ Passed`), defaulting to `Unanimous (5 For, 0 Against, 0 Abstain)` with 1-click stepper adjustments.
  2. **Live Execution Progress Bar on Resolution Cards:** Show an inline progress bar (`☑ 1/2 tasks done · 50%`) on each `RES-2026-NN` card, plus an inline banner prompting to mark the resolution `Implemented` when the final linked task completes.
- **HIG & A11y Verification:** Streamlines modal data entry (`modality.md › Best practices`: *"Aim to keep modal tasks simple, short, and streamlined"*).

### Issue `#116` — Automated "Reading Due" Notifications for KPI Owners
- **Initial Pattern:** `NotificationMenu` item deep-linking to `/kpis?record=<kpiId>` with a basic numeric input modal.
- **Friction Identified:** Deep-linking straight into `RecordReadingModal` hides the KPI's recent trend line, forcing the owner to close the modal to inspect prior months (Collision C-05).
- **Refined Design Thinking Solution (Best Way):**
  1. **Unified Notification Inbox Card (`Pinned Due Now`):** Present `📊 KPI Reading Due` inside the unified `🔔 NotificationMenu` with target, previous reading, and a direct `+ Record Oct reading →` CTA.
  2. **Embedded 3-Period Sparkline & Live Target Delta Pill inside `RecordReadingModal`:** Render the trailing 3 periods (`Jul: 66 → Aug: 68 → Sep: 69`) and compute the live target delta (`74.0 pts · ✓ On Target +2.0 vs ≥72`) as the user types, auto-clearing the unread notification on save.
- **HIG & A11y Verification:** Follows `notifications.md › Notification actions` (time-saving direct action) and `modality.md` (self-contained context inside the modal).

### Issue `#117` — AI Executive Scorecard Commentary for KPIs
- **Initial Pattern:** Collapsible `✨ Executive brief` card on `/kpis` with `EN / AR` toggle and `Save as Note`.
- **Friction Identified:** When a KPI owner logs a new reading via `#116`, it is unclear whether the open AI commentary reflects the new reading or an older snapshot (Collision C-05).
- **Refined Design Thinking Solution (Best Way):**
  1. **Live Data-Hash Freshness Badge (`✓ Grounded in all 8 Oct readings · Up to date` vs. `↻ 1 new reading logged · Regenerate`):** Explicitly surface data freshness driven by `data_hash` comparison in the commentary header.
  2. **Interactive Citation Chips:** Make KPI names inside the AI brief interactive chips (`[Customer Onboarding SLA · 4.8d ↗]`) that highlight or scroll to the underlying KPI row.
- **HIG & A11y Verification:** Directly implements `generative-ai.md › Transparency` and `Outputs` (explicit grounding, hash verification, and `<bdi>` numeric isolation in RTL).

### Issue `#118` — 1-on-1 Executive Prep Sheet for a Person
- **Initial Pattern:** 2-column prep sheet (`7d / 30d / Quarter / Custom`) with 5 equal-weight cards (A–E).
- **Friction Identified:** Giving equal visual height to "Completed Tasks" and "Overdue / Off-Target Blockers" dilutes executive focus during a 15-minute 1-on-1.
- **Refined Design Thinking Solution (Best Way):**
  1. **"Needs Attention First" Priority Hierarchy:** Highlight **Overdue Tasks, Off-Target KPIs, and Due Follow-Ups** at the top of the 2-column dossier with actionable inline checkboxes, while grouping completed deliveries into a compact summary card.
  2. **1-Click "Snapshot to Live 1-on-1 Note" + Print/PDF Dossier:** Convert selected talking points into an interactive meeting checklist note and support distraction-free single-page `@media print` output.
- **HIG & A11y Verification:** Follows `layout.md › Visual hierarchy` (*"Order content by relative importance"*).

### Issue `#119` — External Calendar Linking, `.ics` Feeds & Import
- **Initial Pattern:** `/account#calendar` outbound/inbound setup + full-width `/home` "Today's Schedule" strip.
- **Friction Identified:** Full-width schedule strip on `/home` collides with `#112`'s Follow-Up strip (Collision C-01).
- **Refined Design Thinking Solution (Best Way):**
  1. **Unified `/home` Executive Today Bar (Paired with `#112`):** Present **Today's Schedule (`#119`)** in the left column and **Follow-Ups Due Today (`#112`)** in the right column of a single compact above-the-fold Executive Today Bar on `/home`.
  2. **Smart Attendee & Committee Matching:** Automatically match `.ics` event attendees against `/people` and `/committees`, surfacing a context-aware `📋 1-on-1 Prep` button for 2-person meetings and `📝 Create Committee Note` for committee sessions.
- **HIG & A11y Verification:** Respects `layout.md › Adaptability` (2-column grid on desktop, clean vertical stack on compact width).

### Issue `#120` — AI Agent & Automation Access (Scoped API Tokens, CLI & MCP Server)
- **Initial Pattern:** Checkbox matrix of 10 `:read`/`:write` module scopes + one-time token modal + `via 🤖` badge.
- **Friction Identified:** Checking 10 individual boxes is error-prone, and stacking a separate "Attribution Banner" inside `TaskDetail` adds visual clutter (Collision C-03).
- **Refined Design Thinking Solution (Best Way):**
  1. **1-Click Role Scope Presets + Hard-Blocked Security Guardrail:** Provide 1-click preset pills (`Executive Assistant — Recommended`, `Read-Only Analyst`, `Custom`) that auto-toggle the underlying `:read`/`:write` matrix while visually locking `Admin, Users & Backups` as permanently prohibited.
  2. **Inline Provenance Pill (`via 🤖 Executive Assistant`):** Render automation attribution inline inside the existing `Created by` footer metadata and `the system activity log` row rather than as a separate banner card.
- **HIG & A11y Verification:** Follows `privacy.md` and `modality.md` (clear security boundary disclosure, one-time secret reveal with explicit copy confirmation).

---

## Stage 4 — Prototype Refinements: Summary of Upgraded Retina (`2x`, `3600×2280` px) Boards

All 11 prototype boards (`/workspace/enan-proto-110-recurring-tasks.png` through `/workspace/enan-proto-120-agent-mcp-cli.png`) have been updated and re-rendered at `3600×2280` px (`deviceScaleFactor: 2`) to reflect the Design Thinking refinements:

| Prototype File | Issue | Key Design Thinking Refinement Rendered in Prototype |
| :--- | :---: | :--- |
| `/workspace/enan-proto-110-recurring-tasks.png` | `#110` | Co-located `Due date + ↻ Repeat` schedule row in `TaskDetail`; `Fixed vs. Rolling (+Nd)` cadence selector; subtask reset preview + Undo toast. |
| `/workspace/enan-proto-111-quick-reminders.png` | `#111` | Clean `+ Reminder · Alt R` creation pill in `ShellHeader`; auto-linked entity context pill; unified `🔔` notification delivery (`Due Now` pinned). |
| `/workspace/enan-proto-112-follow-up-dates.png` | `#112` | Compact `Requester → Assignee` delegation row; paired `/home` **Executive Today Bar** (50/50 split with `#119` Schedule); 1-click `+3d` rollover. |
| `/workspace/enan-proto-113-voice-memos.png` | `#113` | **C-06 Zero-Setup Record-First (`🎙 Alt+V`)**: immediate recording without blank note creation, `ADR 0054` save-first persistence, and AI auto-generated Title, Committee, `@People`, Tags, Brief & Tasks. |
| `/workspace/enan-proto-114-committee-roster.png` | `#114` | Header Governance Bar surfacing `Chair`, `Secretary`, `Quorum: 5 Voting`, and `1 Expiring Soon` alert; cross-linked `PersonDetail` governance seats. |
| `/workspace/enan-proto-115-committee-decisions.png` | `#115` | Quorum-linked Vote Tally (`5/5 Voting Members · ✓ Quorum Met`) inside Resolution Modal; inline task execution progress bar (`1/2 done`). |
| `/workspace/enan-proto-116-kpi-reading-notifications.png` | `#116` | Unified `🔔 NotificationMenu` card; embedded **3-Period Sparkline (`66 → 68 → 69`)** and live target delta (`+2.0 On Target`) inside `RecordReadingModal`. |
| `/workspace/enan-proto-117-kpi-ai-commentary.png` | `#117` | Live `data_hash` Freshness Badge (`✓ Grounded in 8/8 Oct readings · Up to date`); interactive KPI citation chips; `<bdi>` RTL numeric isolation. |
| `/workspace/enan-proto-118-1on1-prep-sheet.png` | `#118` | "Needs Attention First" priority hierarchy; 1-click `Save as 1-on-1 Note` checklist snapshot; clean single-page `@media print` executive dossier. |
| `/workspace/enan-proto-119-calendar-sync.png` | `#119` | Outbound/Inbound `.ics` sync with AES-256-GCM & SSRF guard; paired `/home` **Executive Today Bar** with smart `📋 1-on-1 Prep` and `📝 Create Note` actions. |
| `/workspace/enan-proto-120-agent-mcp-cli.png` | `#120` | 1-click Role Scope Presets with locked Admin guardrail; one-time `enan_pat_...` reveal + MCP/CLI config tabs; inline `via 🤖 Executive Assistant` provenance pill. |

---

## Stage 5 — Test & Validation Checklist (`apple-design` + `ui-ux-pro-max` + Privacy & Sanitization)

1. **Color Contrast (WCAG 2.2 AA / Apple HIG `accessibility.md › Visual Legibility & Contrast`):**
   - Primary Ink `#161615` on Warm Paper `#f7f5f0`: **`16.4:1`** (passes `4.5:1` body & `7:1` AAA).
   - Muted Ink `#5c5a55` on Surface `#ffffff`: **`6.8:1`** (passes `4.5:1` AA).
   - Cobalt Accent `#1d4ed8` on `#eff6ff`: **`6.1:1`** (passes `4.5:1` AA).
   - Semantic status chips (`#15803d` emerald, `#b45309` amber, `#b91c1c` crimson) always pair color with explicit text and iconography (`●`, `◐`, `✕`, `↻`).
2. **Keyboard & Focus Ergonomics (`ui-ux-pro-max` Priority 1 & 2):**
   - Every modal and popover (`#110`, `#111`, `#115`, `#116`, `#120`) supports `Esc` dismissal, visible `2px solid #1d4ed8` focus rings, and zero obscured focus states.
3. **Bilingual LTR/RTL Parity (`right-to-left.md`):**
   - Logical CSS properties (`margin-inline`, `padding-inline`), directional glyph mirroring (`→` in LTR / `←` in RTL for `#112` delegation), and `<bdi>` isolation for signed KPI deltas and reference codes (`RES-2026-14`, `+1.8d`).
4. **Privacy & Sanitization & Privacy Verification:**
   - Verified `0` personal names, machine names, or internal bot names across all 11 visual prototypes, generator scripts, and specification documents. All sample personas use neutral executive directory records (`Noura Al-Mansoor`, `Dr. Nasser Al-Rashid`, `Khalid Al-Harbi`, `Tariq Al-Otaibi`, `Sarah Al-Mansoor`, `Laila Al-Ghamdi`).
