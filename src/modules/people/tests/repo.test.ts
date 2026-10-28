import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { db, closeDatabase } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { countQueries } from '@/core/db/query-log';
import { AppError } from '@/core/http/errors';
import { Kind, PersonListQuery, View } from '../schema/validation';
import * as repo from '../repo';
import * as service from '../service';
import { harness } from './fixtures';
import { seedPeople } from '../../../../tests/fixtures/people';
beforeAll(() => migrateDatabase());
beforeEach(() => harness.reset());
afterAll(() => closeDatabase());
const noFacets = { q: '', tag: '', organization: '' };
const today = new Date().toISOString().slice(0, 10);
const names = (rows: { fullName: string }[]) => rows.map((row) => row.fullName);
const list = (query: object) =>
  harness.run((ctx) => service.listPeople(ctx, PersonListQuery.parse({ view: 'all', ...query })));
// The six sample people, one of them in trash, so every view has members and non-members.
async function directory() {
  const people = [];
  for (const sample of seedPeople)
    people.push(
      await harness.person(sample.fullName, { ...sample, kind: Kind.parse(sample.kind) }),
    );
  const [, , maya] = people;
  if (!maya) throw new Error('fixture missing');
  await harness.run((ctx) => service.removePerson(ctx, maya.id, maya.revision));
  return people;
}
it('PEOPLE-B02 PEOPLE-B08 every view returns exactly the rows its count reports, under the same facets', async () => {
  await directory();
  for (const facets of [
    noFacets,
    { ...noFacets, organization: 'Northbridge Studio' },
    { ...noFacets, q: 'cedar' },
  ]) {
    const counts = await repo.countPeople(db(), facets, View.options);
    for (const view of View.options) {
      const rows = await repo.selectPeople(db(), { view, ...facets }, 100, null, today);
      expect(rows, `${view} with ${JSON.stringify(facets)}`).toHaveLength(counts?.[view] ?? -1);
    }
  }
  // Membership is the view's own predicate: trash is the deleted rows and nothing else, the other
  // views carry no deleted row (07 § deleted_at is null unless includeDeleted).
  const all = await repo.selectPeople(db(), { view: 'all', ...noFacets }, 100, null, today);
  expect(all.every((row) => row.deletedAt === null)).toBe(true);
  expect(names(all)).not.toContain('Maya Faris');
  const trash = await repo.selectPeople(db(), { view: 'trash', ...noFacets }, 100, null, today);
  expect(names(trash)).toEqual(['Maya Faris']);
  expect(trash.every((row) => row.deletedAt !== null)).toBe(true);
  const assignable = await repo.selectPeople(
    db(),
    { view: 'assignable', ...noFacets },
    100,
    null,
    today,
  );
  expect(assignable).toHaveLength(3);
  expect(assignable.every((row) => row.isAssignable && row.deletedAt === null)).toBe(true);
  const external = await repo.selectPeople(
    db(),
    { view: 'external', ...noFacets },
    100,
    null,
    today,
  );
  expect(names(external).sort()).toEqual(['Daniel Rowan', 'ريم الخطيب']);
  const internal = await repo.countPeople(db(), noFacets, ['internal']);
  expect(internal?.internal).toBe(3);
});
it('PEOPLE-B02 the directory sorts by case-folded name and breaks ties on id', async () => {
  // The sort key is `lower(full_name)`, a required column, so there is no null to place: the
  // tie-breaker is what keeps two identical names in one stable order across pages.
  const bravo = await harness.person('bravo');
  const alphaUpper = await harness.person('Alpha');
  const alphaLower = await harness.person('alpha');
  const charlie = await harness.person('Charlie');
  const rows = await repo.selectPeople(db(), { view: 'all', ...noFacets }, 10, null, today);
  const alphas = [alphaUpper, alphaLower].sort((a, b) => (a.id < b.id ? -1 : 1));
  expect(rows.map((row) => row.id)).toEqual([...alphas.map((p) => p.id), bravo.id, charlie.id]);
});
it('PEOPLE-B02 a cursor continues past an insert between pages and is refused when the filters change', async () => {
  for (const name of ['Bashir', 'Dalia', 'Farah', 'Hana']) await harness.person(name);
  const first = await list({ limit: 2 });
  expect(names(first.data)).toEqual(['Bashir', 'Dalia']);
  expect(first.meta.nextCursor).not.toBeNull();
  // A row that sorts before the cursor is not on the following pages; one that sorts after it is.
  await harness.person('Adam');
  await harness.person('Ghada');
  const second = await list({ limit: 2, cursor: first.meta.nextCursor });
  expect(names(second.data)).toEqual(['Farah', 'Ghada']);
  const third = await list({ limit: 2, cursor: second.meta.nextCursor });
  expect(names(third.data)).toEqual(['Hana']);
  expect(third.meta.nextCursor).toBeNull();
  // The cursor is bound to the filters it was issued under (docs/04 § Lists).
  const foreign = list({ limit: 2, cursor: first.meta.nextCursor, tag: 'Board' });
  await expect(foreign).rejects.toBeInstanceOf(AppError);
  await expect(foreign).rejects.toMatchObject({
    code: 'validation_failed',
    details: { fieldErrors: { cursor: ['cursor_mismatch'] } },
  });
  await expect(
    list({ limit: 2, cursor: first.meta.nextCursor, view: 'trash' }),
  ).rejects.toMatchObject({ code: 'validation_failed' });
});
it('PEOPLE-B02 SEARCH-B01 the search folds Arabic forms and case on the query and on the corpus', async () => {
  await harness.person('سامر منصور', { organization: 'مؤسسة الأفق' });
  await harness.person('مصطفى كامل');
  await harness.person('Leila Haddad', {
    roleTitle: 'Chief of staff',
    email: 'leila@example.test',
  });
  const search = async (q: string) =>
    names(await repo.selectPeople(db(), { view: 'all', ...noFacets, q }, 10, null, today));
  // Hamza alef on the record, bare alef in the query.
  expect(await search('الافق')).toEqual(['سامر منصور']);
  // Tashkeel in the query, none on the record.
  expect(await search('سَامِر')).toEqual(['سامر منصور']);
  // Alef maqsura on the record, yeh in the query.
  expect(await search('مصطفي')).toEqual(['مصطفى كامل']);
  // Latin case, and the role and email are part of the corpus.
  expect(await search('LEILA')).toEqual(['Leila Haddad']);
  expect(await search('chief of')).toEqual(['Leila Haddad']);
  expect(await search('leila@example')).toEqual(['Leila Haddad']);
  expect(await search('nobody')).toEqual([]);
  // The counts see the same normalised predicate as the rows.
  const counts = await repo.countPeople(db(), { ...noFacets, q: 'الأفق' }, ['all']);
  expect(counts?.all).toBe(1);
});
it('PEOPLE-B02 the tag facet matches a whole tag and the organization facet an exact value', async () => {
  await harness.person('Tagged', { tags: ['Board', 'Finance'], organization: 'Cedar Advisory' });
  await harness.person('Untagged', { tags: [], organization: 'Cedar' });
  const facet = async (facets: Partial<typeof noFacets>) =>
    names(await repo.selectPeople(db(), { view: 'all', ...noFacets, ...facets }, 10, null, today));
  expect(await facet({ tag: 'Finance' })).toEqual(['Tagged']);
  expect(await facet({ tag: 'Fin' })).toEqual([]);
  expect(await facet({ organization: 'Cedar' })).toEqual(['Untagged']);
  expect(await facet({ organization: 'Cedar Advisory', tag: 'Board' })).toEqual(['Tagged']);
});
it('PEOPLE-B02 PEOPLE-B08 the list and its view counts cost two statements beside the workspace day', async () => {
  for (const name of ['One', 'Two', 'Three']) await harness.person(name);
  const listed = await countQueries(() => list({ limit: 50 }));
  // One read of the workspace's time zone, which decides what is late on a card (PEOPLE-B02); one
  // select carrying the page, its cursor tuples and each card's counts; one carrying every view's
  // count.
  expect(listed.queries).toBe(3);
  expect(listed.result.data).toHaveLength(3);
  expect(listed.result.meta.counts).toMatchObject({ all: 3, trash: 0 });
});
it('PEOPLE-I01 a homonym is found case-insensitively and a deleted one no longer counts', async () => {
  const leila = await harness.person('Leila Haddad');
  expect((await repo.possibleDuplicates(db(), 'leila haddad')).map((row) => row.id)).toEqual([
    leila.id,
  ]);
  expect(await repo.possibleDuplicates(db(), 'Leila')).toEqual([]);
  await harness.run((ctx) => service.removePerson(ctx, leila.id, leila.revision));
  expect(await repo.possibleDuplicates(db(), 'Leila Haddad')).toEqual([]);
});
it('PEOPLE-B10 the tag list counts the tags on people outside the trash, most used first', async () => {
  await harness.person('Amal Saleh', { tags: ['Board', 'finance'] });
  await harness.person('Badr Nasser', { tags: ['board'] });
  await harness.person('Dana Fahad', { tags: ['Board'] });
  const gone = await harness.person('Ceyda Aras', { tags: ['Board', 'Legacy'] });
  await harness.run((ctx) => service.removePerson(ctx, gone.id, gone.revision));
  const listed = await harness.run((ctx) => service.listTags(ctx));
  expect(listed.data).toEqual([
    { tag: 'Board', count: 2 },
    { tag: 'board', count: 1 },
    { tag: 'finance', count: 1 },
  ]);
});
it('PEOPLE-B02 each card counts the open tasks a person owns and how many of them are late', async () => {
  const owner = await harness.person('Hala Omar', { isAssignable: true });
  const idle = await harness.person('Iman Zaid', { isAssignable: true });
  await harness.task('Draft the plan', { ownerId: owner.id });
  await harness.task('Send the minutes', { ownerId: owner.id, dueDate: '2000-01-03' });
  const listed = await list({ limit: 50 });
  const stats = (id: string) => listed.data.find((row) => row.id === id)?.stats;
  expect(stats(owner.id)).toEqual({ openTasks: 2, lateTasks: 1, notes: 0 });
  expect(stats(idle.id)).toEqual({ openTasks: 0, lateTasks: 0, notes: 0 });
});
