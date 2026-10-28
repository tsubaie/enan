import 'server-only';
import { createHash } from 'node:crypto';
import type { Context } from '@/core/auth/session';
import type { NotificationSubject } from '@/core/modules/server-manifest';
import { emitUnattended } from '@/core/notifications/emit';
import { routes } from '@/core/routes';
import { lastSucceeded } from '@/core/db/jobs-repo';
import type { Database } from '@/core/db/client';
import {
  healthOf,
  outdated,
  readUpdates,
  stalledAfter,
  type UpdaterStatus,
} from '@/core/updates/updater';
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
  'update.updater_outdated',
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

// The notification an outcome raises, if any.
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
      return failedEvent(entry);
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

// A check that could not reach the registry is shown on the page but raises nothing: it repeats
// every interval until the network is back. ADMIN-B74: a replacement of the updater that failed
// names the updater, not the release it keeps as the candidate.
function failedEvent(entry: UpdaterStatus): Event | null {
  if (entry.step === 'check') return null;
  if (entry.step === 'updater')
    return {
      kind: 'update.failed',
      key: `failed:updater:${entry.updaterUpdate ?? ''}:${entry.finishedAt}`,
      title: shortDigest(entry.updaterUpdate) ?? 'Enan',
    };
  return {
    kind: 'update.failed',
    key: `failed:${entry.candidate?.digest ?? ''}:${entry.finishedAt}`,
    title: named(entry.candidate),
  };
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

// ADMIN-B69: the updater is older than this release of Enan needs. Keyed by what it understands,
// so a newer but still too old updater is news again.
function outdatedEvent(status: UpdaterStatus): Event {
  return {
    kind: 'update.updater_outdated',
    key: `outdated:${status.protocol}`,
    title: named(status.running),
  };
}
// When this process started: a new release of Enan is a new process, and that is when an updater
// can fall behind it.
const processStart = new Date();

// NOTIF-B06: a subject resolves only for an administrator, from the updater's own record.
export async function resolve(ctx: Context, ids: readonly string[]) {
  const subjects = new Map<string, NotificationSubject>();
  if (ctx.user.role !== 'admin') return subjects;
  const { status, history } = await readUpdates();
  const events = [
    ...(status ? [stalledEvent(status), outdatedEvent(status)] : []),
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

// What the updater's state says rather than its history, each raised once: an updater that went
// quiet on the run in which it crossed the limit, and one too old for this release (ADMIN-B69) on
// the first run since Enan started.
function stateEvents(
  status: UpdaterStatus,
  now: Date,
  since: number,
  previous: Date | null,
  started: Date,
) {
  const events: Event[] = [];
  const last = status.lastCheckAt ? Date.parse(status.lastCheckAt) : NaN;
  if (
    healthOf(status, now) === 'stalled' &&
    !Number.isNaN(last) &&
    last + stalledAfter(status) > since
  )
    events.push(stalledEvent(status));
  if (outdated(status) && started.getTime() > (previous?.getTime() ?? -Infinity))
    events.push(outdatedEvent(status));
  return events;
}

// ADMIN-B59: whenever the updater writes its status, and daily, the outcomes it recorded since the
// last run become notifications for every active administrator, and so does an updater that just
// went quiet or is too old for this release (ADMIN-B69).
export async function notifyUpdates(
  database: Database,
  job: string,
  now = new Date(),
  started = processStart,
) {
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
  events.push(...stateEvents(status, now, since, previous, started));
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
