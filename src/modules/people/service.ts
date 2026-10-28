/** PEOPLE-I01–I04: required identity, confirmed homonyms, admin-only member linking, principal protection. */
import 'server-only';
import { transactional } from '@/core/db/transaction';
import { z } from 'zod';
import { type Context } from '@/core/auth/session';
import { id } from '@/core/db/ids';
import { getSetting } from '@/core/db/settings-repo';
import { dayAt } from '@/core/time/tasks';
import { isUniqueViolation } from '@/core/db/errors';
import { toJson, writeAudit } from '@/core/db/audit-repo';
import { decodeCursor, encodeCursor, filtersHash } from '@/core/db/keyset';
import { applyUpdate, requireRevision, restoreByOp, type EntityOps } from '@/core/entity/service';
import { AppError } from '@/core/http/errors';
import {
  Person,
  View,
  type PersonCreate,
  type PersonPatch,
  PersonListQuery,
} from './schema/validation';
import * as repo from './repo';
export { personNameSql } from './repo';
type PersonRow = NonNullable<Awaited<ReturnType<typeof repo.selectPerson>>>;
const ops: EntityOps<Person, PersonRow, Parameters<typeof repo.updatePerson>[3]> = {
  entityType: 'person',
  get: (ctx, personId, includeDeleted) => getPerson(ctx, personId, includeDeleted),
  update: (ctx, personId, revision, patch) =>
    repo.updatePerson(ctx.db, personId, revision, patch, ctx.user.id),
  restore: (ctx, personId, opId) => repo.restorePerson(ctx.db, personId, opId, ctx.user.id),
};
// ADR 0011: people are the only owner identity, so the directory owns the answer to "who can hold
// this". Other modules ask for the list rather than reassembling the query themselves.
export async function assignablePeople(ctx: Context) {
  const listed = await listPeople(ctx, PersonListQuery.parse({ view: 'assignable', limit: 200 }));
  return listed.data.map((row) => ({
    id: row.id,
    name: row.fullName,
    hasLogin: row.userId !== null,
  }));
}
export async function listPeople(ctx: Context, query: PersonListQuery) {
  const { view, q, tag, organization, withTotal } = query;
  const hash = filtersHash({ view, q, tag, organization });
  const rows = await repo.selectPeople(
    ctx.db,
    query,
    query.limit + 1,
    decodeCursor(query.cursor, repo.nameSort, hash),
    dayAt(await getSetting(ctx.db, 'workspace.timezone')),
  );
  const counts = z
    .record(View, z.number())
    .parse(await repo.countPeople(ctx.db, { q, tag, organization }, View.options));
  const items = rows.slice(0, query.limit);
  const last = items.at(-1);
  return {
    data: items.map((row) => Person.parse(row)),
    meta: {
      counts,
      // PEOPLE-B08: meta.total is opt-in (04-api-conventions.md); the view counts always ship.
      ...(withTotal === 'true' ? { total: counts[view] } : {}),
      nextCursor:
        rows.length > query.limit && last ? encodeCursor(repo.nameSort, hash, last) : null,
    },
  };
}
export async function countPeople(ctx: Context) {
  const row = await repo.countPeople(ctx.db, { q: '', tag: '', organization: '' }, ['all']);
  return row?.all ?? 0;
}
export async function getPerson(ctx: Context, personId: string, deleted = false) {
  const row = await repo.selectPerson(ctx.db, personId);
  if (!row || (!deleted && row.deletedAt))
    throw new AppError('not_found', { entityType: 'person' });
  return Person.parse(row);
}
function memberLink(ctx: Context, userId?: string | null) {
  if (userId !== undefined && ctx.user.role !== 'admin')
    throw new AppError('forbidden', { reason: 'role' });
}
// PEOPLE-I02: `people.user_id` is unique, and the index is the guard against two writes linking
// the same member at once. The failure is reported as the state conflict PEOPLE-B04 uses for a
// member who is already linked elsewhere, not as a database error.
async function linkChecked<T>(work: () => Promise<T>) {
  try {
    return await work();
  } catch (error) {
    if (isUniqueViolation(error, ['people.user_id']))
      throw new AppError('conflict', { reason: 'state' });
    throw error;
  }
}
// PEOPLE-B13: an internal record whose address is a workspace login's, where neither is linked
// yet, is that login's record. An explicit `userId` (admin only) always wins.
async function matchedLogin(
  ctx: Context,
  kind: string | undefined,
  email: string | null | undefined,
  linked: string | null,
) {
  if (linked || kind !== 'internal' || !email) return null;
  return repo.selectUnlinkedUserByEmail(ctx.db, email);
}
// PEOPLE-B13: exposed for Users, so a login created after its directory record finds it.
export const linkPersonForUser = transactional(async function linkPersonForUser(
  ctx: Context,
  userId: string,
  email: string,
) {
  return repo.linkUnlinkedPerson(ctx.db, userId, email);
});
export const createPerson = transactional(async function createPerson(
  ctx: Context,
  input: PersonCreate,
) {
  if (input.userId) memberLink(ctx, input.userId);
  // Two creates of the same name serialize on the immediate transaction (ADR 0029), so the second
  // one reads the first as a possible duplicate.
  const duplicates = (await repo.possibleDuplicates(ctx.db, input.fullName)).map((row) =>
    Person.parse(row),
  );
  if (duplicates.length && !input.confirmDuplicate)
    return { data: null, meta: { possibleDuplicates: duplicates } };
  const { confirmDuplicate, ...given } = input;
  void confirmDuplicate;
  const fields = {
    ...given,
    userId: given.userId ?? (await matchedLogin(ctx, given.kind, given.email, null)),
  };
  const person = Person.parse(
    await linkChecked(() =>
      repo.insertPerson(ctx.db, {
        ...fields,
        id: id(),
        createdBy: ctx.user.id,
        updatedBy: ctx.user.id,
      }),
    ),
  );
  await writeAudit(ctx.db, ctx.user.id, 'create', 'person', person.id, toJson(fields));
  return { data: person, meta: { possibleDuplicates: [] } };
});
export const patchPerson = transactional(async function patchPerson(
  ctx: Context,
  personId: string,
  input: PersonPatch,
) {
  memberLink(ctx, input.userId);
  const { revision, ...given } = input;
  const current = await requireRevision(ctx, ops, personId, revision);
  const login =
    given.userId === undefined
      ? await matchedLogin(
          ctx,
          given.kind ?? current.kind,
          given.email === undefined ? current.email : given.email,
          current.userId,
        )
      : null;
  const fields = login ? { ...given, userId: login } : given;
  return Person.parse(await linkChecked(() => applyUpdate(ctx, ops, current, fields)));
});
export const removePerson = transactional(async function removePerson(
  ctx: Context,
  personId: string,
  revision: number,
) {
  const principal = await getSetting(ctx.db, 'workspace.principal_person_id');
  if (principal === personId) throw new AppError('rule_violation', { rule: 'PEOPLE-I04' });
  const current = await requireRevision(ctx, ops, personId, revision);
  const opId = id();
  await applyUpdate(
    ctx,
    ops,
    current,
    { deletedAt: new Date(), deletedOpId: opId },
    { action: 'delete', opId, diff: {} },
  );
  return { opId };
});
export const restorePerson = transactional(async function restorePerson(
  ctx: Context,
  personId: string,
  opId: string,
) {
  await getPerson(ctx, personId, true);
  return Person.parse(await restoreByOp(ctx, ops, personId, opId));
});

export async function listTags(ctx: Context) {
  return { data: await repo.selectTags(ctx.db) };
}
export async function aiPeople(ctx: Context) {
  return repo.selectAiPeople(ctx.db);
}
// ACCT-B05: exposed for the account page, which shows the reader's directory record without
// editing it. Other modules reach People through this index, never through its repo.
export async function personForUser(ctx: Context, userId: string) {
  return repo.selectPersonForUser(ctx.db, userId);
}
// NOTIF-B04: exposed so an emitting module can turn the people an event concerns into the accounts
// that can be told about it. Core may not read this table, so the resolution lives here.
export async function userIdsForPeople(ctx: Context, personIds: readonly string[]) {
  return repo.selectUserIdsForPeople(ctx.db, personIds);
}
