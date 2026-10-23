import 'server-only';
import { z } from 'zod';
import type { Context } from '@/core/auth/session';
import { toJson, writeAudit } from '@/core/db/audit-repo';
import { AppError } from '@/core/http/errors';
// Service-side composition of the entity rules every module shares: revision conflicts carry the
// current row, every write leaves an audit entry, restores are keyed by operation id.
type Json = z.infer<ReturnType<typeof z.json>>;
type Versioned = { id: string; revision: number };
export type EntityOps<T extends Versioned, Row extends object, P extends object = object> = {
  entityType: string;
  get: (ctx: Context, entityId: string, includeDeleted?: boolean) => Promise<T>;
  update: (ctx: Context, entityId: string, revision: number, patch: P) => Promise<Row | undefined>;
  restore?: (
    ctx: Context,
    entityId: string,
    opId: string,
    extra?: object,
  ) => Promise<Row | undefined>;
};
export function revisionConflict(current: object) {
  return new AppError('conflict', { reason: 'revision', current: toJson(current) });
}
export async function requireRevision<T extends Versioned, Row extends object, P extends object>(
  ctx: Context,
  ops: EntityOps<T, Row, P>,
  entityId: string,
  revision: number,
  includeDeleted = false,
) {
  const current = await ops.get(ctx, entityId, includeDeleted);
  if (current.revision !== revision) throw revisionConflict(current);
  return current;
}
export type AuditOptions = { action?: string; opId?: string | null; diff?: Json };
export async function applyUpdate<T extends Versioned, Row extends object, P extends object>(
  ctx: Context,
  ops: EntityOps<T, Row, P>,
  current: Versioned,
  patch: P,
  audit: AuditOptions = {},
): Promise<Row> {
  const row = await ops.update(ctx, current.id, current.revision, patch);
  if (!row) throw revisionConflict(await ops.get(ctx, current.id, true));
  const action = audit.action ?? 'update';
  const diff = audit.diff ?? toJson(patch);
  await writeAudit(
    ctx.db,
    ctx.user.id,
    action,
    ops.entityType,
    current.id,
    withName(action === 'delete' ? diff : withBefore(diff, current), current, action === 'delete'),
    audit.opId ?? null,
  );
  return row;
}
// ADMIN-B71: every entry names its record (its title or name) under `_name`, so the log says which
// one even when the title was not what changed; a deletion also keeps it as a field, shown in red.
function withName(diff: Json, current: object, deleted: boolean): Json {
  if (!diff || typeof diff !== 'object' || Array.isArray(diff)) return diff;
  const named = z
    .object({ title: z.string(), name: z.string(), fullName: z.string() })
    .partial()
    .parse(current);
  const name = named.title ?? named.name ?? named.fullName;
  if (name === undefined) return diff;
  const names = Object.fromEntries(
    Object.entries(named).filter(([, value]) => value !== undefined),
  );
  return toJson(deleted ? { ...names, ...diff } : { ...diff, _name: name });
}
// ADMIN-B71: an edit also records what the changed fields read before it, under `_before`, so the
// audit log can show the change as before and after. Long text is left out: the log only says it
// was edited, and keeping a second copy of every note body would double the log for nothing.
function withBefore(diff: Json, current: object): Json {
  if (!diff || typeof diff !== 'object' || Array.isArray(diff)) return diff;
  const was = toJson(current);
  if (!was || typeof was !== 'object' || Array.isArray(was)) return diff;
  const before: Record<string, Json> = {};
  for (const key of Object.keys(diff)) {
    const value = was[key];
    if (value === undefined || (typeof value === 'string' && value.length > 200)) continue;
    before[key] = value;
  }
  return Object.keys(before).length ? { ...diff, _before: before } : diff;
}
export async function restoreByOp<T extends Versioned, Row extends object, P extends object>(
  ctx: Context,
  ops: EntityOps<T, Row, P>,
  entityId: string,
  opId: string,
  extra?: object,
): Promise<Row> {
  if (!ops.restore) throw new Error(`${ops.entityType} cannot be restored`);
  const row = await ops.restore(ctx, entityId, opId, extra);
  if (!row) throw new AppError('conflict', { reason: 'state' });
  await writeAudit(
    ctx.db,
    ctx.user.id,
    'restore',
    ops.entityType,
    entityId,
    withName({}, row, false),
    opId,
  );
  return row;
}
// EP-B46: rows given in a new order take the places the same rows held before, so reordering a
// few of them never disturbs the rows outside the request. Every revision is checked first; the
// caller's immediate transaction serialises concurrent reorders (ADR 0029).
export async function reorderInPlace<
  T extends Versioned & { sortOrder: number },
  Row extends object,
>(
  ctx: Context,
  ops: EntityOps<T, Row, { sortOrder: number }>,
  items: { id: string; revision: number }[],
) {
  const rows: T[] = [];
  for (const item of items) rows.push(await requireRevision(ctx, ops, item.id, item.revision));
  const places = rows.map((row) => row.sortOrder).sort((a, b) => a - b);
  for (const [index, row] of rows.entries()) {
    const sortOrder = places[index] ?? index;
    if (row.sortOrder !== sortOrder)
      await applyUpdate(ctx, ops, row, { sortOrder }, { action: 'reorder' });
  }
  return { data: { updatedIds: items.map((item) => item.id) } };
}
