import 'server-only';
import { createHash } from 'node:crypto';
import type { Context } from '@/core/auth/session';
import type { NotificationSubject } from '@/core/modules/server-manifest';
import { emitUnattended } from '@/core/notifications/emit';
import { routes } from '@/core/routes';
import { lastSucceeded } from '@/core/db/jobs-repo';
import type { Database } from '@/core/db/client';
import { healthOf, readUpdates, stalledAfter, type UpdaterStatus } from '@/core/updates/updater';
import { selectAdminIds } from './repo';

// ADMIN-B59, ADR 0022: the update kinds. The administration area owns the updater's page, so this
// module owns its notifications; only administrators can resolve them.
export const kinds = [
  'update.available',
  'update.installed',
  'update.failed',
  'update.rollback_failed',
  'update.blocked',
  'update.stalled',
];
export const updatesJob = 'users.updates';

// A subject is an event, not a row: a v8 UUID derived from what it is about, so the same outcome
// read twice is the same subject and NOTIF-I02 keeps it to one unread line.
export function subjectId(key: string) {
  const hex = createHash('sha256').update(key).digest('hex').slice(0, 32).split('');
  hex[12] = '8';
  hex[16] = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  const text = hex.join('');
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
}

type Event = { kind: string; key: string; title: string };
const shortDigest = (digest: string | undefined) => digest?.replace('sha256:', '').slice(0, 12);
const named = (image: UpdaterStatus['running']) =>
  image?.version ?? shortDigest(image?.digest) ?? 'Enan';

// The notification an outcome raises, if any. A check that could not reach the registry is shown
// on the page but raises nothing: it repeats every interval until the network is back.
export function eventOf(entry: UpdaterStatus): Event | null {
  // ADMIN-B67: once per release; the updater records an announcement once, too.
  if (entry.state === 'available')
    return {
      kind: 'update.available',
      key: `available:${entry.candidate?.digest ?? ''}`,
      title: named(entry.candidate),
    };
  return outcomeEvent(entry);
}

function outcomeEvent(entry: UpdaterStatus): Event | null {
  const candidate = entry.candidate?.digest ?? '';
  switch (entry.state) {
    case 'updated':
      return {
        kind: 'update.installed',
        key: `installed:${entry.running?.digest ?? entry.finishedAt}`,
        title: named(entry.running),
      };
    case 'rolled_back':
    case 'failed':
      if (entry.step === 'check') return null;
      return {
        kind: 'update.failed',
        key: `failed:${candidate}:${entry.finishedAt}`,
        title: named(entry.candidate),
      };
    case 'rollback_failed':
      return {
        kind: 'update.rollback_failed',
        key: `rollback_failed:${candidate}:${entry.finishedAt}`,
        title: named(entry.candidate),
      };
    // Held for the operator (a contract migration). An image held because it failed before was
    // already reported as failed.
    case 'blocked':
      if (entry.step !== 'guard') return null;
      return { kind: 'update.blocked', key: `blocked:${candidate}`, title: named(entry.candidate) };
  }
  return null;
}

function stalledEvent(status: UpdaterStatus): Event {
  return {
    kind: 'update.stalled',
    // The running image, not the last check: that moves on once the updater is back, and the line
    // would stop resolving to its version.
    key: `stalled:${status.running?.digest ?? ''}`,
    title: named(status.running),
  };
}

// NOTIF-B06: a subject resolves only for an administrator, from the updater's own record.
export async function resolve(ctx: Context, ids: readonly string[]) {
  const subjects = new Map<string, NotificationSubject>();
  if (ctx.user.role !== 'admin') return subjects;
  const { status, history } = await readUpdates();
  const events = [
    ...(status ? [stalledEvent(status)] : []),
    ...[...(status ? [status] : []), ...history].flatMap((entry) => eventOf(entry) ?? []),
  ];
  const href = routes.admin('updates');
  for (const id of ids) {
    const event = events.find((candidate) => subjectId(candidate.key) === id);
    // An event older than the updater's history still opens the page.
    subjects.set(id, { title: event?.title ?? 'Enan', href });
  }
  return subjects;
}

// ADMIN-B59: every few minutes, the outcomes the updater recorded since the last run become
// notifications for every active administrator, and so does an updater that just went quiet.
export async function notifyUpdates(database: Database, job: string, now = new Date()) {
  const { status, history } = await readUpdates(now);
  if (!status) return;
  const previous = await lastSucceeded(database, updatesJob, job);
  const since = previous ? previous.getTime() : now.getTime() - 10 * 60 * 1000;
  const fresh = (at: string | undefined) => {
    const time = at ? Date.parse(at) : NaN;
    return time > since && time <= now.getTime();
  };
  const events = [...history]
    .reverse()
    .filter((entry) => fresh(entry.finishedAt))
    .flatMap((entry) => eventOf(entry) ?? []);
  const last = status.lastCheckAt ? Date.parse(status.lastCheckAt) : NaN;
  // Raised once: on the run in which the updater crossed the limit, not on every run after it.
  if (
    healthOf(status, now) === 'stalled' &&
    !Number.isNaN(last) &&
    last + stalledAfter(status) > since
  )
    events.push(stalledEvent(status));
  if (!events.length) return;
  const to = await selectAdminIds(database);
  await emitUnattended(
    database,
    events.map((event) => ({
      kind: event.kind,
      subjectType: 'users',
      subjectId: subjectId(event.key),
      to,
    })),
  );
}
