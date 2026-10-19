import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { closeDatabase, db, withTransaction, type Database } from '@/core/db/client';
import { clearDatabase } from '@/core/db/reset';
import { migrateDatabase } from '@/core/db/migrate';
import { insertUser } from '@/core/db/auth-repo';
import { getSetting } from '@/core/db/settings-repo';
import { countQueries } from '@/core/db/query-log';
import { id } from '@/core/db/ids';
import { env } from '@/core/config/env';
import { User } from '@/core/http/user-schema';
import { addDays, dayAt } from '@/core/time/tasks';
import { createTask } from '@/modules/tasks/service';
import { TaskCreate } from '@/modules/tasks/schema/validation';
import { createCommittee } from '@/modules/committees/service';
import { CommitteeCreate } from '@/modules/committees/schema/validation';
import { createPerson, removePerson } from '@/modules/people';
import { PersonCreate, personDraft } from '@/modules/people/schema/validation';
import { createNote } from '@/modules/notes/service';
import { NoteCreate } from '@/modules/notes/schema/validation';
import { Home } from '../schema/validation';
import { homeApi } from '../api';
// The aggregate is read the way the page reads it: one real `Request` against the real database,
// with the cookie session and the error translator stood in for. The data comes through the
// owning modules' services, so every row carries the facts their providers put on it.
const session = vi.hoisted(() => ({ user: null as User | null }));
vi.mock('@/core/auth/session', () => ({ currentUser: async () => session.user }));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
let user: User;
type Ctx = { db: Database; user: User; requestId: string };
const run = <T>(action: (ctx: Ctx) => Promise<T>) =>
  withTransaction(db(), (database) => action({ db: database, user, requestId: id() }));
beforeAll(() => migrateDatabase());
beforeEach(async () => {
  await clearDatabase();
  user = User.parse(
    await insertUser(db(), {
      id: id(),
      name: 'Home Reader',
      email: 'home@example.test',
      passwordHash: 'unused-test-hash',
      role: 'admin',
    }),
  );
  session.user = user;
});
afterAll(() => closeDatabase());
async function home() {
  const response = await homeApi(new Request(new URL('/api/v1/home', env().APP_URL)));
  return { status: response.status, headers: response.headers, body: await response.json() };
}
const task = (title: string, fields: Partial<TaskCreate> = {}) =>
  run((ctx) => createTask(ctx, TaskCreate.parse({ title, ...fields })));
const committee = (name: string) =>
  run((ctx) => createCommittee(ctx, CommitteeCreate.parse({ name })));
async function person(fullName: string, fields: Partial<PersonCreate> = {}) {
  const created = await run((ctx) =>
    createPerson(ctx, PersonCreate.parse({ ...personDraft(fullName), ...fields })),
  );
  if (!created.data) throw new Error('person not created');
  return created.data;
}
const workspaceToday = async () => dayAt(await getSetting(db(), 'workspace.timezone'));
type Section = ReturnType<typeof Home.parse>['sections'][number];
type Json = z.infer<ReturnType<typeof z.json>>;
const section = (body: { data: Json }, key: string): Section => {
  const found = Home.parse(body.data).sections.find((item) => item.key === key);
  if (!found) throw new Error(`section ${key} missing`);
  return found;
};
it('HOME-B03 the aggregate is session guarded and read-only', () => {
  expect(homeApi.meta).toMatchObject({ guard: 'session', status: 200, idempotent: false });
  expect(homeApi.meta.input.safeParse({ view: 'all' }).success).toBe(false);
});
it('HOME-B03 HOME-B02 GET /home needs a session and answers every section in one envelope, each with its own way in', async () => {
  session.user = null;
  const anonymous = await home();
  expect(anonymous.status).toBe(401);
  expect(anonymous.body.error.code).toBe('unauthenticated');
  session.user = user;
  await task('Overdue report', { dueDate: '2000-01-01' });
  const response = await home();
  expect(response.status).toBe(200);
  expect(response.headers.get('X-Request-Id')).toBeTruthy();
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  const data = Home.parse(response.body.data);
  expect(data.name).toBe('Home Reader');
  expect(data.sections.map((item) => item.key)).toEqual([
    'nextMeetings',
    'prep',
    'overdue',
    'today',
    'waiting',
    'committees',
    'kpis',
    'initiatives',
    'notes',
  ]);
  for (const item of data.sections) {
    // An installed section carries its link; an absent module is reported, not invented.
    if (item.enabled) expect(item.href).toMatch(/^\/[a-z]+\?view=/u);
    else expect(item).toMatchObject({ count: 0, href: null, items: [] });
    for (const row of item.items) expect(row.href).toMatch(/^\/[a-z]+\?/u);
  }
  expect(data.sections.filter((item) => item.enabled).map((item) => item.key)).toEqual([
    'overdue',
    'today',
    'waiting',
    'committees',
    'kpis',
    'notes',
  ]);
});
it('HOME-A01 HOME-B01 HOME-B03 every installed section opens its module in the matching view, and the page composes no URL', async () => {
  const response = await home();
  const hrefs = Object.fromEntries(
    Home.parse(response.body.data)
      .sections.filter((item) => item.enabled)
      .map((item) => [item.key, item.href]),
  );
  expect(hrefs).toEqual({
    overdue: '/tasks?view=overdue',
    today: '/tasks?view=today',
    waiting: '/tasks?view=waiting',
    committees: '/committees?view=open',
    kpis: '/kpis?view=attention',
    notes: '/notes?view=this_week',
  });
});
it('HOME-A02 HOME-B03 the aggregate completes within its query budget with every section carrying data', async () => {
  const board = await committee('Board');
  const holder = await person('Holder Person', { kind: 'internal', isAssignable: true });
  await task('Late', { dueDate: '2000-01-01', committeeId: board.id });
  await task('Now', { dueDate: await workspaceToday() });
  await task('Chase', { status: 'waiting_on', ownerId: holder.id });
  await run((ctx) => createNote(ctx, NoteCreate.parse({ title: 'Recent note' })));
  const { result, queries } = await countQueries(home);
  expect(result.status).toBe(200);
  expect(queries).toBeLessThanOrEqual(12);
  for (const key of ['overdue', 'today', 'waiting', 'committees', 'notes'])
    expect(section(result.body, key).count).toBe(1);
});
it('HOME-A04 HOME-B01 a committee carrying an open task appears under Committees with open work, which opens the open view', async () => {
  const busy = await committee('Consumer protection');
  await committee('Idle committee');
  await task('Draft the circular', { committeeId: busy.id });
  const response = await home();
  const committees = section(response.body, 'committees');
  expect(committees.href).toBe('/committees?view=open');
  expect(committees.count).toBe(1);
  expect(committees.items).toEqual([
    expect.objectContaining({
      id: busy.id,
      title: 'Consumer protection',
      count: 1,
      href: `/committees?view=all&id=${busy.id}`,
    }),
  ]);
});
it('HOME-A05 HOME-A07 HOME-B10 HOME-B09 rows carry the fact their section asks for: the overdue due date, the holder with count and late share, the committee’s open and late work', async () => {
  const today = await workspaceToday();
  const audit = await committee('Audit');
  const holder = await person('Leila Haddad', { kind: 'internal', isAssignable: true });
  const lateDate = addDays(today, -3);
  const late = await task('Late letter', { dueDate: lateDate, committeeId: audit.id });
  await task('Open memo', { committeeId: audit.id });
  await task('Awaiting reply', { status: 'waiting_on', ownerId: holder.id, dueDate: lateDate });
  await task('Awaiting figures', { status: 'waiting_on', ownerId: holder.id });
  const response = await home();
  const overdue = section(response.body, 'overdue');
  // Late is late whatever the status: the waiting reply past its date is overdue work as well.
  expect(overdue.count).toBe(2);
  // The row states when it was due; the page turns that into "3 days late" against the day.
  expect(overdue.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: late.id,
        title: 'Late letter',
        date: lateDate,
        committee: 'Audit',
        revision: late.revision,
      }),
    ]),
  );
  const waiting = section(response.body, 'waiting');
  expect(waiting.count).toBe(2);
  expect(waiting.items).toEqual([
    expect.objectContaining({
      id: holder.id,
      title: 'Leila Haddad',
      owner: 'Leila Haddad',
      count: 2,
      overdue: 1,
      date: lateDate,
      href: `/tasks?view=waiting&ownerId=${holder.id}`,
    }),
  ]);
  const committees = section(response.body, 'committees');
  expect(committees.items).toEqual([
    expect.objectContaining({ title: 'Audit', count: 2, overdue: 1, done: 0 }),
  ]);
});
it('HOME-A08 HOME-B14 with one task due today, two in two days and one in nine, the week reads 1, 0, 2, 0, 0, 0, 0 beside the overdue count', async () => {
  const today = await workspaceToday();
  const plus = (days: number) => addDays(today, days);
  await task('Now', { dueDate: today });
  await task('Soon', { dueDate: plus(2) });
  await task('Also soon', { dueDate: plus(2) });
  await task('Later', { dueDate: plus(9) });
  await task('Late', { dueDate: '2000-01-01' });
  const response = await home();
  const week = section(response.body, 'today');
  expect(week.days?.map((day) => day.date)).toEqual([0, 1, 2, 3, 4, 5, 6].map(plus));
  expect(week.days?.map((day) => day.count)).toEqual([1, 0, 2, 0, 0, 0, 0]);
  expect(week.days?.[2]?.href).toBe(`/tasks?view=all&due=${plus(2)}`);
  expect(week.count).toBe(1);
  expect(section(response.body, 'overdue')).toMatchObject({ count: 1, days: null });
});
it('HOME-B11 the payload carries the directory headcount, counting the people who are still there', async () => {
  const first = await person('First Person');
  await person('Second Person');
  expect(Home.parse((await home()).body.data).peopleCount).toBe(2);
  await run((ctx) => removePerson(ctx, first.id, first.revision));
  expect(Home.parse((await home()).body.data).peopleCount).toBe(1);
});
