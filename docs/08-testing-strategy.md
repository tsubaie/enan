# 08 — Testing strategy

Tests exist to prove behavior. The unit of proof is a **scenario named by requirement ID**. A test that would pass after deleting the feature is not a test.

## Layers

| Layer | Tool | Runs against | Location |
|---|---|---|---|
| Schema | Vitest | Zod only | `modules/<m>/tests/schema.test.ts` |
| Service and repo | Vitest | a real SQLite file (`DATABASE_URL_TEST`, one file per worker) | `modules/<m>/tests/service.test.ts`, `repo.test.ts` |
| Constraints | Vitest, raw SQL | a real SQLite file | `modules/<m>/tests/constraints.test.ts` |
| API | Vitest calling route handlers with `Request` | real DB, seeded sessions | `modules/<m>/tests/api.test.ts` |
| Component | Vitest + Testing Library + MSW | mocked API | `modules/<m>/tests/ui/*.test.tsx` |
| AI | Vitest + `FakeProvider` | no network | `modules/<m>/tests/ai.test.ts` |
| Core adversarial | Vitest, two DB clients on one file, child process for runner | real DB | `src/core/**/tests/` |
| End-to-end | Playwright | built app + seeded DB | `e2e/<m>.spec.ts` |
| Audit self-tests | Vitest | violating fixtures under `scripts/audit/tests/fixtures` | `scripts/audit/tests` |

Mocking the database is forbidden. There is no database server: a test database is a SQLite file whose basename ends in `_test.db` (`file:./tmp/executiveos_test.db` in `.env.test.example`), created from the migrations by `ensureTestDatabase`, which also creates the parent directory; the suite refuses any other name. Vitest workers never share a file: the test setup derives a per-worker path (for example by appending `VITEST_POOL_ID`). Before a browser run, global setup empties the database and re-applies the migrations, but only when the file's name ends in `_test.db` (`resetDisposableDatabase` in `src/core/db/reset.ts`); any other database, such as a developer's own, is kept as it is, and production refuses. Browser tests find records through the list's search field and wait for that exact query in the URL before clicking, so leftovers never decide what a test sees.

## Scenario naming

```ts
it("TASKS-B02 refuses completing a parent with open subtasks unless force", …)
it("TASKS-A04 restores parent and cascade-deleted subtasks only", …)
```

The docs audit cross-references IDs between specs and test names. A requirement without a test fails the audit; a test naming an unknown ID fails the audit.

## Required coverage per module

1. **Every behavior ID** in the spec has at least one scenario at the layer that owns it (service for rules, repo for list semantics, API for contracts, UI for interaction).
2. **Every invariant** has a scenario that attempts to violate it through the service and asserts the `AppError` code, plus a constraints scenario that attempts it with raw SQL and asserts the database rejects it (where a DB constraint exists).
3. **Every acceptance criterion** has an e2e scenario in `en` and `ar`.
4. **Every mutation** has an API scenario for: happy path, validation failure with dotted field paths, 401, 403 (admin routes and origin check), 404 for deleted ids, 409 on stale revision, idempotent replay, envelope shape.
5. **Every list** has repo scenarios for: each view equals its count under the same facets, sort tuples with nulls, cursor continuation with an insert between pages, cursor rejection on changed filters, `linkedTo`, search normalization (Arabic forms).
6. **Every AI capability** has: fixture happy path in `en` and `ar`, adversarial fixture, schema drift, refusal and invalid-output handling, request capture (what was sent, what was excluded), apply idempotency, stale-source 409, disabled-AI absence.
7. **Mutation tests for critical rules**: for each module, three rules listed in the spec's audit items are verified by temporarily inverting the implementation in CI (`pnpm test:mutate`, Stryker on the listed functions) and asserting the suite fails.

## Core adversarial suite (`src/core/**/tests`)

| Scenario | Method |
|---|---|
| Concurrent revision updates | two connections, one wins, other gets 409 |
| Job claimed twice after lease expiry, first handler finishes late | fencing rejects the late result; one `job_attempts` row per attempt |
| Runner killed mid-handler | spawn runner as child process, SIGKILL, restart; job reclaimed after lease; side effects not duplicated |
| Duplicate `dedup_key` insert | returns the existing job |
| Scheduler occurrence twice | second insert no-op |
| Duplicate `Idempotency-Key` | replay; different hash → 409 |
| Cross-user private notes | user B cannot read A's note via API, server component, job payload, audit log, or export |
| Setup race | two concurrent setup submissions, one succeeds |
| Last admin protection | deactivate or demote refused |
| Upload crash between file write and DB insert | orphan sweep removes the file; no dangling row |
| Backup consistency | writes during backup; restore verifies manifest and every referenced file exists |
| Restore drill | restore into empty DB, app boots, golden paths pass |
| Migration lock | two migrators on one file, one applies; the other waits at `BEGIN IMMEDIATE` and finds nothing to do |
| Write queue | two concurrent immediate transactions with awaits inside; the second waits and commits, neither sees `SQLITE_BUSY`; a pool transaction requested inside a running one is refused at once; a lock held by another connection past the driver's wait fails cleanly and the pool recovers |
| Foreign keys | an orphan insert through raw SQL is rejected on every pooled connection |
| Restore file swap | restore closes the client, swaps the file, reopens; a query during the swap gets the maintenance 503, and the next query after it succeeds |

## Test data and clocks

- Factories in `tests/factories/` create data through services with `ctx`. Constraint tests use raw SQL on purpose.
- Fresh transaction per test (`BEGIN … ROLLBACK`) or truncate helper. No order dependence.
- `vi.setSystemTime()` for anything date-related; boundaries tested at 23:59:59 in two timezones (`Asia/Riyadh`, `America/New_York`) from fixtures, and at quarter and year rollovers.
- Locale-sensitive scenarios run under `describe.each(["en", "ar"])`.

## Forbidden patterns

Reading source files in tests (except audit self-tests) · re-implementing logic under test · whole-component snapshots (small structural snapshots of RTL SVG or `dir` attributes are allowed) · mocking `repo` in service tests or `service` in API tests · `test.skip`/`todo` on main without an issue link · sleeping instead of `findBy*`/`waitFor` · asserting only on `it()` counts.

## Coverage

Collected, thresholds per file class: `service.ts` and `schema/validation.ts` ≥ 90 percent branches; `repo.ts` ≥ 80; UI ≥ 70. Uncovered branches in services are listed and justified in the PR.

## CI

1. `pnpm install --frozen-lockfile`
2. `pnpm lint`, `pnpm typecheck`, `pnpm depcruise`
3. `pnpm knip`, `pnpm audit:structure`, `audit:i18n`, `audit:portability`, `audit:docs`, `audit:schema`, `audit:tests`, `gitleaks`
4. `pnpm test` with `DATABASE_URL_TEST` pointing at a `file:` path under `tmp/` (includes core adversarial suite and audit self-tests); no service container
5. `pnpm build`, `pnpm audit:bundle`
6. `pnpm test:e2e` on two lanes (below), both locales, two workspace configurations
7. `pnpm audit:openapi`, `pnpm audit:a11y`
8. `pnpm test:mutate` on the listed critical functions (nightly, not per PR, if runtime exceeds 10 minutes)

Nightly: `ai-smoke.yml`, `pnpm test:mutate`.

Where it runs: `.github/workflows/ci.yml` targets GitHub's hosted runners (`ubuntu-latest`, x86-64). The repository variable `CI_RUNS_ON` (JSON, quotes included) sends a run elsewhere, for example `["self-hosted", "linux", "x64"]`. The repository is public, so a pull request from a fork runs its own code on whatever runner the workflow names: never point it at a self-hosted runner that holds anything else. The browser job runs in the Playwright container that matches the lockfile's `@playwright/test` version, and `gitleaks` is unpacked into the job's temp directory in the build for the runner's architecture.

Caching: a hosted runner starts empty, so the jobs restore what a rebuild would otherwise redo from GitHub's cache service: pnpm's store (`actions/setup-node`), Next's incremental build cache (`.next/cache`, in each browser job) and Docker's layer cache (`type=gha`, written only by `main`). Next builds run with `NEXT_BUILD_CPUS=4` workers (the workflow env and an image build arg; `next.config.ts` turns it into `experimental.cpus` and webpack's memory optimisations). The docker job runs on a pull request only when the files that shape the image changed (Dockerfile, `.dockerignore`, `package.json`, the lockfile, compose files, `next.config.ts`; a `changes` job decides, and the gate accepts the skip only then) and always on a push to `main`, where it publishes `ghcr.io/<owner>/<repository>` and smoke-tests it. The unit and integration stage (`pnpm audit:data`) is split the same way with Vitest's `--shard`, in four jobs, each with its own SQLite file; the schema audit runs in the first. The browser stage is split across runners with Playwright's `--shard`: the desktop project in six jobs and the mobile project in five, each on two lanes. The audits that follow the suite in `pnpm audit:browser` (bundle, OpenAPI, accessibility, performance) run in their own job, after one short spec that provisions lane 0's administrator. On CI a failed browser test is retried once and, if it then passes, reported as flaky in the Playwright report; locally there are no retries. Browser tests run with reduced motion, which shortens page transitions (ADR 0019) to 1 ms; at full length the outgoing page shares the DOM with the incoming one for about half a second. More shards cost nothing on a public repository's hosted runners; each one adds a build and a cold start, about a minute and a half.

Deployment is opt-in: the `deploy` job runs on a push to `main` only when the repository variable `DEPLOY_ENABLED` is `true`. It runs in the `production` environment, which admits only `main` and holds the server as secrets, so the public logs mask them: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_DIR` and `DEPLOY_OVERLAY` (ADR 0040).

### Browser-test lanes

The suite runs on two Playwright workers at once (`E2E_WORKERS`, 1–8). Its tests change state (tasks, notes, settings, the workspace), so each worker owns a **lane** (`e2e/lanes.ts`): its own SQLite file (`…_test.db`, `…-lane1_test.db`), its own standalone server on its own port (`3000`, `3001`, …), its own `FILES_DIR` and `BACKUP_DIR`, and its own administrator (`e2e/.auth/credentials.json`, `credentials-lane1.json`). One production build serves every lane. Every spec imports `test` from `e2e/fixtures/test.ts`, whose worker fixture sets `E2E_LANE` and `baseURL`, so `credentials()`, `loginAs()` and `laneBaseURL()` default to the worker's lane and the specs need not know lanes exist. The global setup resets and provisions every lane through the real first-run API. The audits that run after the suite (`audit:a11y`, `audit:perf`) use lane 0, whose addresses are the historical ones. `E2E_WORKERS=1` gives the old single-server run.

## Hand-off requirement

The hand-off lists every requirement ID in the work item with the test file and scenario name that proves it, and the `pnpm audit:all` summary.
