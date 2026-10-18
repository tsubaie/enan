<img src="docs/zimam-mark.svg" width="56" height="56" alt="Zimam mark">

# Zimam · زمام

A self-hosted executive office: tasks, people, committees, meeting notes and a KPI scorecard, all in one place, running on your own server.

[zimam.ing](https://zimam.ing) · by [Talal A. Alsubaie](https://ta.sa) · Apache-2.0 · development preview

![Zimam Home: tasks due today, overdue actions, the week ahead, who you are waiting on and the KPIs that need attention](docs/screenshots/home-en-desktop.webp)

<sub>The company, people and numbers in the screenshots are invented.</sub>

## What it is

Zimam is for an executive and the small office around them. It holds the work that usually ends up spread across email, spreadsheets and someone's notebook: what is due, who owes what, what the board agreed, and which KPIs are slipping. It runs as one Docker container with its data in one SQLite file. There is no database server, no separate worker and no subscription. It is bilingual, English and Arabic, with right-to-left support.

## Why “Zimam”

A *zimam* (زمام) is the rein, the rope a rider holds to steer a camel. In Arabic, to “take the zimam of things” (أخذ بزمام الأمور) means to take charge. That is the job of this app: to keep the reins of your office in your hands.

## What works today

- **Home**: what is due today, what slipped, the week ahead, who you are waiting on, and KPIs that need a look.
- **Tasks**: owners, priorities, subtasks, due-date bands from Overdue to No date, links to a committee, and a trash you can restore from.
- **Notes**: meeting notes with type, date, committee, participants and @mentions.
- **Committees**: the board, the ExCo and other standing bodies, each with its own tasks and notes.
- **KPIs**: objectives, readings and targets. Status (On track, Late, Stale, No data) is computed, and the reason is shown next to it.
- **People**: a light directory, with each person's open tasks.
- **Search**: one box (<kbd>Ctrl</kbd> <kbd>K</kbd>) across tasks, notes, committees, KPIs and people.
- **Admin**: users, settings, AI, backups, jobs and an audit log. Notifications are in-app.
- **Optional AI**: note refine, tag suggestions and task breakdown. See [AI](#ai).

It is a responsive web app. Phones use the same app in the browser, and there is nothing to install from a store.

<table>
  <tr>
    <td><img src="docs/screenshots/home-en-mobile.webp" width="260" alt="Home on a phone, in English"></td>
    <td><img src="docs/screenshots/home-ar-mobile.webp" width="260" alt="The same Home screen on a phone, in Arabic, laid out right to left"></td>
  </tr>
</table>

**Coming:** Meetings (agenda, attendees, documents and minutes), Initiatives (deliverables and progress), and links between records, such as a KPI and the meeting that discussed it. There are no email or calendar integrations, and no hosted version.

## Quick start (Docker)

You need Docker with Compose.

```bash
git clone https://github.com/tsubaie/zimam.git && cd zimam
cp .env.example .env
```

Edit `.env` and set:

- `SESSION_SECRET`: a random string of at least 32 characters, for example the output of `openssl rand -hex 32`.
- `APP_URL`: the address people will open, for example `http://localhost:3000`.

Leave `DATABASE_URL` as it is, because it points at the data volume. Then run:

```bash
docker compose up -d --build
docker compose logs app | grep SETUP_TOKEN
```

Open http://localhost:3000 and finish setup with that token. Migrations run on start. To upgrade, `git pull` and run `docker compose up -d --build` again.

The app listens on `127.0.0.1:3000` only. To use it beyond localhost, put it behind a reverse proxy that terminates TLS and set an `https://` `APP_URL`. Production refuses to start without one.

## Configuration

Every variable is documented in [`.env.example`](.env.example). These are the ones you are most likely to touch:

| Variable                | Default                         | Purpose                                                                         |
| ----------------------- | ------------------------------- | ------------------------------------------------------------------------------- |
| `SESSION_SECRET`        | (required)                      | 32+ characters. Keep it stable: saved AI keys are encrypted with it.            |
| `APP_URL`               | `http://localhost:3000`         | The browser origin. It must be `https` in production, except on loopback.       |
| `DATABASE_URL`          | `file:` path on the data volume | The SQLite file. Keep it on a local disk, not a network share.                  |
| `TRUSTED_PROXY_CIDRS`   | empty                           | Your proxy's addresses, so per-address login throttling sees real clients.      |
| `OPENROUTER_API_KEY`    | empty                           | Optional fallback. A key saved in **Admin → AI** takes precedence.              |
| `FILES_QUOTA_GB`        | `20`                            | Storage quota for uploaded files.                                               |
| `MAX_UPLOAD_MB`         | `20`                            | The largest single upload.                                                      |
| `RECOVERY_TOKEN`        | empty                           | A one-time admin recovery token. Set it, restart, use it, then remove it.       |
| `LOG_LEVEL`             | `info`                          | `trace` through `fatal`.                                                        |

## AI

AI is optional and stays off until an administrator adds an [OpenRouter](https://openrouter.ai) key in **Admin → AI**. You bring your own key and pay for your own usage. The key is stored encrypted and is never shown again. Calls go through the Anthropic SDK pointed at OpenRouter.

There are three capabilities: refining a meeting note, suggesting tags, and breaking a task into subtasks. Each one proposes, and nothing changes until someone accepts it. An administrator can set a monthly spending cap. Without a key, nothing leaves your machine.

## Data and backups

The whole office lives in one SQLite file on the `data` volume. Uploaded files and backups sit beside it on the `files` and `backups` volumes. You can take backups from **Admin → Backups**, or from the command line:

```bash
docker compose exec app pnpm backup:create
docker compose exec app pnpm backup:restore /var/lib/executiveos/backups/BACKUP_ID --confirm
```

A restore replaces the database and the uploaded files, so it requires `--confirm`. Keep a copy of `SESSION_SECRET` with your backups, because a backup cannot decrypt a saved AI key without it.

## Development

You need Node 22 and pnpm 10 (`corepack enable`).

```bash
pnpm install
cp .env.example .env     # set SESSION_SECRET, and for a local checkout
                         # DATABASE_URL=file:./tmp/dev.db, FILES_DIR=./tmp/files, BACKUP_DIR=./tmp/backups
pnpm dev                 # http://localhost:3000; applies migrations on start
```

The `db:*` scripts read their settings from the environment, so load `.env` into the shell first:

```bash
set -a && . ./.env && set +a
pnpm db:migrate          # create or upgrade the SQLite file
pnpm db:demo             # on an empty database: a fictional demo office, and its sign-in
```

Tests use their own throwaway SQLite file:

```bash
cp .env.test.example .env.test
pnpm test                # unit and integration
pnpm test:e2e            # Playwright, against a production build
pnpm audit:all           # the full gate: lint, types, audits, tests, build, a11y, perf
```

To develop inside Docker with hot reload, run `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build`.

The specification lives in [`docs/`](docs/README.md). Requirements have IDs, and each one has a test named after it. If you are a person or an AI agent working on the code, start with [`AGENTS.md`](AGENTS.md).

## Status

This is a development preview. It has no version number yet and no supported release. Data formats and screens may still change, so keep backups. What exists and what is still planned is tracked in [`docs/STATUS.md`](docs/STATUS.md) and [`docs/11-roadmap.md`](docs/11-roadmap.md).

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md). Please do not open a public issue for them.

## بالعربية

<div dir="rtl">

**زمام** مكتب تنفيذي مفتوح المصدر تستضيفه على خادمك. يجمع المهام والأشخاص واللجان وملاحظات الاجتماعات ومؤشرات الأداء في مكان واحد. يعمل بالعربية والإنجليزية، ويدعم الكتابة من اليمين إلى اليسار. تُحفظ بياناته في ملف SQLite واحد داخل حاوية Docker واحدة. والذكاء الاصطناعي اختياري، ويبقى مطفأً حتى تضيف مفتاحك.

**لماذا «زمام»؟** الزمام حبلٌ يقود به الراكب ناقته، ومنه قولهم: أخذ بزمام الأمور. وهذا ما صُنع له زمام: أن تبقى أمور مكتبك في يدك.

هذه نسخة تطوير أولية، صُنعت في السعودية. خطوات التشغيل في قسم [Quick start](#quick-start-docker) أعلاه: انسخ المستودع، ثم اضبط ملف ‎`.env`‎، ثم شغّل ‎`docker compose up -d --build`‎.

</div>

## License

[Apache License 2.0](LICENSE). See also [NOTICE](NOTICE).

---

Made in Saudi Arabia by [Talal A. Alsubaie](https://ta.sa) · [ta.sa](https://ta.sa). Also by Talal: [RusTXT](https://rustxt.ing) and [NumPad](https://numpad.ing).
