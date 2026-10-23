# Architecture Decision Records

One decision per file. Format: **Status**, **Context**, **Decision**, **Consequences**, **Alternatives considered**. Accepted ADRs are never edited except to add a superseded-by line; a new ADR supersedes them. `audit:docs` checks that accepted ADR bodies are unchanged since acceptance.

| # | Title | Status |
|---|---|---|
| 0001 | Next.js App Router with TypeScript as the single deployable | accepted |
| 0002 | PostgreSQL with Drizzle ORM and generated plus custom migrations | superseded by 0029 |
| 0003 | In-process AI via the Claude API and a Postgres-backed job runner | accepted, extended by 0010 |
| 0004 | shadcn/ui on Base UI with semantic tokens as the design system | accepted |
| 0005 | Own multi-user auth with cookie sessions and roles | accepted, login throttling refined by 0013; sessions and login superseded by 0055 |
| 0006 | Hybrid linking with mirrored structural relations | superseded by 0009 |
| 0007 | Local file storage and native PDF input for meeting briefs | accepted |
| 0008 | Scope of the "no CLI" rule; backups with bundled PostgreSQL client binaries | accepted, restore sequence refined by 0024, backup mechanism superseded by 0029 |
| 0009 | Contextual links table plus a projected edges view | accepted |
| 0010 | Job execution contract: leases, fencing, dedup keys, all AI as jobs | accepted |
| 0011 | People are the single identity for task owners and attendees | accepted |
| 0012 | Notes are standalone entities and are never threaded | accepted |
| 0013 | Trusted client addresses, independent throttling buckets, and uniform login cost | accepted |
| 0014 | Notes carry participants from mentions and link tasks by source note | accepted |
| 0015 | Markdown rendering with react-markdown and a sanitizing schema | accepted |
| 0016 | OpenRouter with encrypted in-app credentials | accepted |
| 0017 | OpenRouter task and note capability execution | accepted, monthly token budget superseded by 0033 |
| 0018 | Configurable AI hourly admission limits | accepted |
| 0019 | Page transitions with React's `<ViewTransition>` | accepted |
| 0020 | The entity detail is a non-modal slide-over | accepted |
| 0021 | Global search fans out over module providers | accepted |
| 0022 | Notifications are a stored, per-user, pull-only feed | accepted |
| 0023 | The route bundle budget is 272 KB | accepted, figure superseded by 0038 |
| 0024 | Restore stages files and swaps them in after the database; the runner drains before it aborts | accepted |
| 0025 | Security headers from the app, and verified TLS for remote databases | accepted, database TLS part superseded by 0029 |
| 0026 | A restore that may have split database and files stays in maintenance; restores are serialized; drained jobs retry | accepted |
| 0027 | The database URL's host part is the only place the server is named | superseded by 0029 |
| 0028 | Text fields take their direction from what is typed, and a text area from its first letter | accepted |
| 0029 | SQLite as the only database | accepted |
| 0030 | Night and paper: the visual identity | accepted, night palette and system font superseded by 0031 |
| 0031 | The night theme follows Apple's dark materials | accepted, night accent superseded by 0036, drawn indigo wallpaper by 0037 |
| 0032 | Inter and Noto Sans Arabic carry the whole interface | accepted |
| 0033 | The monthly AI limit is in US dollars | accepted |
| 0034 | Meeting files are archived, never deleted | accepted |
| 0035 | A retention setting of 0 means never | accepted |
| 0036 | The Sadu mark, and a sage accent in the night theme | accepted, fixed accent superseded by 0037 (sage kept as fallback), mark superseded by 0046 |
| 0037 | Uploaded wallpapers, and the accent follows the wallpaper | accepted |
| 0038 | The route bundle budget is 300 KB | accepted |
| 0039 | A push to main deploys to the server | accepted, amended by 0040; its image tags changed by 0050; its deploy superseded by 0052 |
| 0040 | CI on GitHub's hosted runners; deployment is opt-in and configured outside the code | accepted; its deployment superseded by 0052 |
| 0041 | Page changes start their data early and prefetch on intent | accepted |
| 0042 | Oxlint replaces ESLint | accepted |
| 0043 | TypeScript 7, and dependency-cruiser parses with swc | accepted |
| 0044 | The runtime image is the standalone output | accepted |
| 0045 | Slow read-only handlers run outside the write lock | accepted |
| 0046 | The ع-horse mark | accepted |
| 0047 | The ع-horse mark, redrawn | accepted |
| 0048 | The product is named Enan | accepted |
| 0049 | An install may supply its own Arabic faces | accepted |
| 0050 | Releases, channel tags, and migrations the previous release can run on | accepted; version numbering and the manual release superseded by 0056 |
| 0051 | Installs update themselves through an opt-in updater service | accepted; the major-version guard superseded by 0056; the opt-in, window and contract variable superseded by 0057 |
| 0052 | The push deploy is removed; the maintainer's install updates itself | accepted |
| 0053 | Email and new sign-in methods extend the own auth; their credentials are sealed in the database | accepted; extending the own auth superseded by 0055 |
| 0054 | Slow work happens before the write lock | accepted |
| 0055 | Better Auth replaces the own auth | accepted |
| 0056 | Calendar versions, published by a workflow | accepted |
| 0057 | Updates are announced by default and installed when an administrator chooses | accepted |
| 0058 | Releases add linux/arm64 images, built at release time | accepted |
| 0059 | The updater and Enan act on events, not polls | accepted |
| 0060 | The updater follows the app's channel and says what it understands | accepted |

Open decisions awaiting an ADR: license (see roadmap); chart library confirmation (`recharts`).
