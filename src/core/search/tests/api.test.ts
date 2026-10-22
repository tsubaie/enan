import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { closeDatabase } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { createHarness } from '@/core/db/test-harness';
import { env } from '@/core/config/env';
import { routes } from '@/core/routes';
import { createTask, removeTask } from '@/modules/tasks/service';
import { TaskCreate } from '@/modules/tasks/schema/validation';
import { createNote, removeNote } from '@/modules/notes/service';
import { NoteCreate } from '@/modules/notes/schema/validation';
import { createKpi, removeKpi } from '@/modules/kpis/service';
import { KpiCreate } from '@/modules/kpis/schema/validation';
import { createCommittee } from '@/modules/committees/service';
import { CommitteeCreate } from '@/modules/committees/schema/validation';
import { createPerson } from '@/modules/people/service';
import { PersonCreate, personDraft } from '@/modules/people/schema/validation';
import { PER_MODULE_LIMIT, TOTAL_LIMIT } from '../types';
import { searchApi } from '../api';
// The route runs against the real registry, the real providers and a real SQLite file. Only the
// session is stood in for: the harness owns one admin actor and `currentUser` answers with it, or
// with nobody when a scenario asks what an anonymous request gets.
const harness = createHarness({ name: 'Search Tester', email: 'search@example.test' });
const session = vi.hoisted(() => ({ signedIn: true }));
vi.mock('@/core/auth/session', () => ({
  currentUser: async () => (session.signedIn ? harness.user : null),
}));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
// SEARCH-B04: one provider is made to fail on demand. The kpis repo is the real one except for
// its search query, which rejects while the switch is on -- the fan-out, the merge and the route
// around it are untouched.
const failure = vi.hoisted(() => ({ kpis: false }));
vi.mock('@/modules/kpis/repo', async (original) => {
  const actual = await original<typeof import('@/modules/kpis/repo')>();
  return {
    ...actual,
    searchKpis: (...args: Parameters<typeof actual.searchKpis>) =>
      failure.kpis
        ? Promise.reject(new Error('fixture: kpis search is down'))
        : actual.searchKpis(...args),
  };
});
beforeAll(() => migrateDatabase());
beforeEach(async () => {
  session.signedIn = true;
  failure.kpis = false;
  await harness.reset();
});
afterAll(() => closeDatabase());
const search = (query: Record<string, string>) =>
  searchApi(
    new Request(new URL(`/api/v1/search?${new URLSearchParams(query)}`, env().APP_URL), {
      headers: { 'X-Requested-With': 'Enan' },
    }),
  );
type Hit = { module: string; id: string; title: string; href: string; rank: 0 | 1 };
type Body = { data: { hits: Hit[]; unavailable: string[] } };
const body = async (response: Response) => (await response.json()) as Body;
const task = (title: string, fields: Partial<TaskCreate> = {}) =>
  harness.run((ctx) => createTask(ctx, TaskCreate.parse({ title, ...fields })));
const note = (title: string, fields: Partial<NoteCreate> = {}) =>
  harness.run((ctx) => createNote(ctx, NoteCreate.parse({ title, ...fields })));
const kpi = (name: string) => harness.run((ctx) => createKpi(ctx, KpiCreate.parse({ name })));
it('SEARCH-B06 the route is a session-guarded read: no idempotency, 401 without a session, and an envelope of hits and unavailable modules only', async () => {
  expect({
    guard: searchApi.meta.guard,
    status: searchApi.meta.status,
    idempotent: searchApi.meta.idempotent,
    source: searchApi.meta.source,
  }).toEqual({ guard: 'session', status: 200, idempotent: false, source: 'body' });
  await task('Envelope shape fixture');
  session.signedIn = false;
  const anonymous = await search({ q: 'envelope' });
  expect(anonymous.status).toBe(401);
  expect(await anonymous.json()).toMatchObject({ error: { code: 'unauthenticated' } });
  session.signedIn = true;
  const response = await search({ q: 'envelope' });
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  const result = await body(response);
  // SEARCH-B06: what is shown and who could not answer; never a total of what exists.
  expect(Object.keys(result.data).sort()).toEqual(['hits', 'unavailable']);
  expect(result.data.unavailable).toEqual([]);
  expect(result.data.hits).toHaveLength(1);
  expect(Object.keys(result.data.hits[0] ?? {}).sort()).toEqual(
    ['href', 'id', 'module', 'rank', 'subtitle', 'title'].sort(),
  );
});
it('SEARCH-B05 SEARCH-A04 a trashed task, a trashed note and a trashed KPI are unreachable while their live siblings match', async () => {
  const live = await task('Visibility live task');
  const trashed = await task('Visibility trashed task');
  await harness.run((ctx) => removeTask(ctx, trashed.id, trashed.revision));
  const keptNote = await note('Visibility live note');
  const removedNote = await note('Visibility trashed note');
  await harness.run((ctx) => removeNote(ctx, removedNote.id, removedNote.revision));
  const keptKpi = await kpi('Visibility live kpi');
  const removedKpi = await kpi('Visibility trashed kpi');
  await harness.run((ctx) => removeKpi(ctx, removedKpi.id, removedKpi.revision));
  const result = await body(await search({ q: 'visibility' }));
  const ids = result.data.hits.map((hit) => hit.id).sort();
  expect(ids).toEqual([live.id, keptNote.id, keptKpi.id].sort());
  // The record is also not reachable by the words only it carries.
  const byName = await body(await search({ q: 'trashed' }));
  expect(byName.data.hits).toEqual([]);
});
it('SEARCH-B03 SEARCH-B06 a module contributes at most five, the list is capped by limit and never above twenty, and nothing counts what was left out', async () => {
  for (let index = 0; index < PER_MODULE_LIMIT + 2; index += 1) await task(`Capped task ${index}`);
  await note('Capped note');
  const all = await body(await search({ q: 'capped' }));
  const tasks = all.data.hits.filter((hit) => hit.module === 'tasks');
  expect(tasks).toHaveLength(PER_MODULE_LIMIT);
  expect(all.data.hits.filter((hit) => hit.module === 'notes')).toHaveLength(1);
  // Round-robin: the note takes its turn after the first task rather than trailing all seven.
  expect(all.data.hits[1]?.module).toBe('notes');
  expect(all.data).not.toHaveProperty('total');
  const two = await body(await search({ q: 'capped', limit: '2' }));
  expect(two.data.hits).toHaveLength(2);
  expect(two.data.hits.map((hit) => hit.module)).toEqual(['tasks', 'notes']);
  const over = await search({ q: 'capped', limit: String(TOTAL_LIMIT + 1) });
  expect(over.status).toBe(400);
  expect(await over.json()).toMatchObject({
    error: { code: 'validation_failed', details: { fieldErrors: { limit: expect.any(Array) } } },
  });
  expect((await search({ q: 'capped', extra: '1' })).status).toBe(400);
});
it('SEARCH-B04 SEARCH-A03 a provider that throws is named as unavailable and the other modules still answer', async () => {
  await kpi('Outage kpi');
  const kept = await task('Outage task');
  failure.kpis = true;
  const response = await search({ q: 'outage' });
  expect(response.status).toBe(200);
  const result = await body(response);
  expect(result.data.unavailable).toEqual(['kpis']);
  expect(result.data.hits.map((hit) => [hit.module, hit.id])).toEqual([['tasks', kept.id]]);
  failure.kpis = false;
  const recovered = await body(await search({ q: 'outage' }));
  expect(recovered.data.unavailable).toEqual([]);
  expect(recovered.data.hits.map((hit) => hit.module).sort()).toEqual(['kpis', 'tasks']);
});
it('SEARCH-B07 every hit carries the owning module route with the record open', async () => {
  const created = {
    tasks: (await task('Landing task')).id,
    notes: (await note('Landing note')).id,
    kpis: (await kpi('Landing kpi')).id,
    committees: (
      await harness.run((ctx) =>
        createCommittee(ctx, CommitteeCreate.parse({ name: 'Landing committee' })),
      )
    ).id,
    people: (
      await harness.run((ctx) =>
        createPerson(ctx, PersonCreate.parse(personDraft('Landing Person'))),
      )
    ).data?.id,
  };
  const result = await body(await search({ q: 'landing' }));
  const hrefs = Object.fromEntries(result.data.hits.map((hit) => [hit.module, hit.href]));
  expect(hrefs).toEqual({
    tasks: routes.tasks({ id: created.tasks }),
    notes: routes.notes({ id: created.notes }),
    kpis: routes.kpis({ id: created.kpis }),
    committees: routes.committees({ id: created.committees }),
    people: routes.person(created.people ?? ''),
  });
  expect(result.data.hits.every((hit) => hit.href.includes(`id=${hit.id}`))).toBe(true);
});
it('SEARCH-A02 SEARCH-B01 an Arabic query without diacritics finds a note written with them, and a single character finds nothing (SEARCH-B02)', async () => {
  const written = await note('مُراجَعَة الميزانيّة');
  const plain = await body(await search({ q: 'مراجعة الميزانية' }));
  expect(plain.data.hits.map((hit) => hit.id)).toEqual([written.id]);
  // A note body is corpus too, and a wildcard in the query is a character, not a pattern.
  const percent = await note('Percent note', { content: 'Target 100% achieved' });
  await note('Percent decoy', { content: 'Target 100 achieved' });
  const escaped = await body(await search({ q: '100%' }));
  expect(escaped.data.hits.map((hit) => hit.id)).toEqual([percent.id]);
  const short = await body(await search({ q: 'م' }));
  expect(short.data).toEqual({ hits: [], unavailable: [] });
});
