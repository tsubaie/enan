import { z } from 'zod';
// ADR 0022. The kinds are a closed set here and a CHECK constraint in the database; the module
// that owns each one declares it on its manifest and the audit checks the three agree.
export const NotificationKind = z.enum([
  'task.assigned',
  'task.due_today',
  'task.overdue',
  'note.mentioned',
  'kpi.off_target',
  'job.finished',
  // ADMIN-B59: owned by the users module, which owns the administration area.
  'update.available',
  'update.installed',
  'update.failed',
  'update.rollback_failed',
  'update.blocked',
  'update.stalled',
  'update.updater_outdated',
]);
export type NotificationKind = z.infer<typeof NotificationKind>;
// NOTIF-B14: the page narrows by the module a kind belongs to, the way the audit log narrows by
// kind of entry. A group is every kind under its prefix, so a kind added later lands in its group.
export const NotificationGroup = z.enum(['all', 'tasks', 'notes', 'kpis', 'ai', 'updates']);
export type NotificationGroup = z.infer<typeof NotificationGroup>;
const groupPrefix: Record<Exclude<NotificationGroup, 'all'>, string> = {
  tasks: 'task.',
  notes: 'note.',
  kpis: 'kpi.',
  ai: 'job.',
  updates: 'update.',
};
export const NotificationFilter = z.union([NotificationGroup, NotificationKind]);
export type NotificationFilter = z.infer<typeof NotificationFilter>;
// The kinds a filter stands for, or null for every kind.
export function kindsOf(filter: NotificationFilter | undefined): NotificationKind[] | null {
  if (filter === undefined) return null;
  const kind = NotificationKind.safeParse(filter);
  if (kind.success) return [kind.data];
  const group = NotificationGroup.parse(filter);
  if (group === 'all') return null;
  return NotificationKind.options.filter((option) => option.startsWith(groupPrefix[group]));
}
export const Notification = z.object({
  id: z.uuid(),
  kind: NotificationKind,
  subjectType: z.string(),
  subjectId: z.uuid(),
  // NOTIF-B06: resolved through the owning module at read time, never stored.
  title: z.string(),
  href: z.string(),
  actorName: z.string().nullable(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
});
export type Notification = z.infer<typeof Notification>;
export const NotificationFeed = z.object({
  data: z.object({
    items: z.array(Notification),
    unread: z.number().int(),
    // NOTIF-B15: every resolvable row matching the filter, for "See all · 37".
    totalCount: z.number().int(),
    nextCursor: z.string().nullable(),
  }),
});
export const FeedQuery = z.strictObject({
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  unread: z.enum(['1', 'true']).optional(),
  kind: NotificationFilter.optional(),
});
export const ReadAllInput = z.strictObject({ kind: NotificationFilter.optional() });
