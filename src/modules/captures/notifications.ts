import 'server-only';
import type { Context } from '@/core/auth/session';
import type { Database } from '@/core/db/client';
import type { NotificationSubject } from '@/core/modules/server-manifest';
import { emitUnattended } from '@/core/notifications/emit';
import { routes } from '@/core/routes';
import { canViewCapture } from './access';
import * as repo from './repo';
// CAPTURES-B21 (ADR 0073): the two lines a recorder hears before Approve, and only the recorder.
// `captures.ready` is one line per recorder (its subject is the recorder's own user id), so the
// unread-row upsert (NOTIF-I02) groups every ready recording into it and moves it to the top; its
// count is read when the bell is, never stored. `captures.failed` is one line per recording. No
// actor, and no transcript or title in the payload.
export const kinds = ['captures.ready', 'captures.failed'];
// A capture whose recorder's account is gone has nobody to tell.
type Recorded = { id: string; createdBy: string | null };
// Called inside the job's publish or fail transaction, after its fence has passed.
export async function notifyReady(database: Database, { createdBy }: Recorded) {
  if (!createdBy) return 0;
  return emitUnattended(database, [
    { kind: 'captures.ready', subjectType: 'captures', subjectId: createdBy, to: [createdBy] },
  ]);
}
export async function notifyFailed(database: Database, { id, createdBy }: Recorded) {
  if (!createdBy) return 0;
  return emitUnattended(database, [
    { kind: 'captures.failed', subjectType: 'captures', subjectId: id, to: [createdBy] },
  ]);
}
// NOTIF-B06: the ready line resolves only for the reader's own id and only while they have a ready
// recording with a pending draft (an administrator never resolves anyone else's batch). A failed
// line resolves while the reader may see the capture and it still reads as failed; a deleted,
// retried or someone else's capture drops it. A failed line's title is the time it was recorded,
// which the row formats ("14:05 recording").
export async function resolve(ctx: Context, ids: readonly string[]) {
  const subjects = new Map<string, NotificationSubject>();
  if (ids.includes(ctx.user.id)) {
    const count = await repo.countReadyForRecorder(ctx.db, ctx.user.id);
    if (count > 0) subjects.set(ctx.user.id, { title: '', href: routes.captures(), count });
  }
  const rows = await repo.selectCaptureSubjects(
    ctx.db,
    ids.filter((id) => id !== ctx.user.id),
  );
  for (const row of rows)
    if (canViewCapture(ctx.user, row) && row.status === 'failed')
      subjects.set(row.id, {
        title: row.createdAt.toISOString(),
        href: routes.captures({ capture: row.id }),
      });
  return subjects;
}
