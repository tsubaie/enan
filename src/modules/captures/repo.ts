import 'server-only';
import { and, desc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '@/core/db/client';
import { restoreEntity } from '@/core/db/entity';
import { files, jobs } from '@/core/db/system-schema';
import { captures, captureSuggestions } from './schema/db';
export type CaptureRow = typeof captures.$inferSelect;
type Reader = { id: string; role: string };
// CAPTURES-B02: the captures a reader may see. One predicate for single reads, lists and counts,
// so no path can widen it: the recorder's own live captures, or any live capture for an admin.
export function visibleCaptures(user: Reader): SQL {
  const live = isNull(captures.deletedAt);
  return (user.role === 'admin' ? live : and(live, eq(captures.createdBy, user.id))) ?? live;
}
// ADR 0070's rule for memos, for captures: a capture waits on the job of its current step; once
// that job has stopped without publishing (or is gone), the capture reads as failed, with the
// job's reason. Nothing has to run when a job fails for the capture to say so.
const waitingJob = sql`case ${captures.status} when 'transcribing' then ${captures.transcribeJobId} when 'interpreting' then ${captures.interpretJobId} end`;
const stalled = sql`${captures.status} in ('transcribing', 'interpreting') and coalesce(${jobs.status}, 'failed') in ('failed', 'cancelled')`;
const status = sql<string>`case when ${stalled} then 'failed' else ${captures.status} end`;
const columns = {
  id: captures.id,
  revision: captures.revision,
  fileId: captures.fileId,
  durationSeconds: captures.durationSeconds,
  transcript: captures.transcript,
  status,
  errorCode: sql<
    string | null
  >`case when ${stalled} then coalesce(${jobs.lastError}, 'provider') else ${captures.errorCode} end`,
  errorDetail: captures.errorDetail,
  contextCommitteeId: captures.contextCommitteeId,
  contextNoteType: captures.contextNoteType,
  transcribeJobId: captures.transcribeJobId,
  interpretJobId: captures.interpretJobId,
  createdAt: captures.createdAt,
  updatedAt: captures.updatedAt,
  createdBy: captures.createdBy,
  updatedBy: captures.updatedBy,
  deletedAt: captures.deletedAt,
};
export async function selectCapture(database: Database, captureId: string) {
  const [row] = await database
    .select(columns)
    .from(captures)
    .leftJoin(jobs, eq(jobs.id, waitingJob))
    .where(eq(captures.id, captureId));
  return row;
}
// The stored row as written, for the jobs' fences, without the derived failure.
export async function selectStoredCapture(database: Database, captureId: string) {
  const [row] = await database.select().from(captures).where(eq(captures.id, captureId));
  return row;
}
export async function selectCaptureAudio(database: Database, captureId: string) {
  const [row] = await database
    .select({
      createdBy: captures.createdBy,
      deletedAt: captures.deletedAt,
      storageKey: files.storageKey,
      mime: files.mime,
      name: files.originalName,
    })
    .from(captures)
    .innerJoin(files, eq(files.id, captures.fileId))
    .where(eq(captures.id, captureId));
  return row;
}
// Newest first, keyset on (created_at, id), always inside the visibility predicate.
export async function selectCaptures(
  database: Database,
  user: Reader,
  limit: number,
  after: { createdAt: Date; id: string } | null,
  scope: 'mine' | 'all' = 'mine',
) {
  return database
    .select(columns)
    .from(captures)
    .leftJoin(jobs, eq(jobs.id, waitingJob))
    .where(
      and(
        visibleCaptures(user),
        scope === 'mine' ? eq(captures.createdBy, user.id) : undefined,
        after
          ? or(
              lt(captures.createdAt, after.createdAt),
              and(eq(captures.createdAt, after.createdAt), lt(captures.id, after.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(captures.createdAt), desc(captures.id))
    .limit(limit);
}
export async function selectSuggestions(database: Database, captureIds: string[]) {
  if (!captureIds.length) return [];
  return database
    .select()
    .from(captureSuggestions)
    .where(
      and(inArray(captureSuggestions.captureId, captureIds), isNull(captureSuggestions.deletedAt)),
    )
    .orderBy(captureSuggestions.createdAt, captureSuggestions.id);
}
// The review badge (§ Behaviors, CAPTURES-B02): the reader's own pending drafts plus own failed
// captures (a stalled job counts as failed), admins included, always inside the visibility
// predicate.
export async function countPendingCaptures(database: Database, user: Reader) {
  const [row] = await database
    .select({
      pending: sql<number>`coalesce(sum(case when ${captureSuggestions.status} = 'pending' then 1 else 0 end), 0)`,
      failed: sql<number>`count(distinct case when ${status} = 'failed' then ${captures.id} end)`,
    })
    .from(captures)
    .leftJoin(jobs, eq(jobs.id, waitingJob))
    .leftJoin(
      captureSuggestions,
      and(eq(captureSuggestions.captureId, captures.id), isNull(captureSuggestions.deletedAt)),
    )
    .where(and(visibleCaptures(user), eq(captures.createdBy, user.id)));
  return Number(row?.pending ?? 0) + Number(row?.failed ?? 0);
}
export async function insertCapture(database: Database, value: typeof captures.$inferInsert) {
  await database.insert(captures).values(value);
}
export async function updateCapture(
  database: Database,
  captureId: string,
  patch: Partial<typeof captures.$inferInsert>,
) {
  await database
    .update(captures)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(captures.id, captureId));
}
// A capture's drafts go with it, under the same operation id, so a restore can find them.
export async function softDeleteCapture(
  database: Database,
  captureId: string,
  userId: string,
  opId: string,
) {
  const deletedAt = new Date();
  await database
    .update(captures)
    .set({ deletedAt, deletedOpId: opId, updatedAt: deletedAt, updatedBy: userId })
    .where(eq(captures.id, captureId));
  await database
    .update(captureSuggestions)
    .set({ deletedAt, deletedOpId: opId, updatedAt: deletedAt })
    .where(and(eq(captureSuggestions.captureId, captureId), isNull(captureSuggestions.deletedAt)));
}
// The undo of `softDeleteCapture`: only rows carrying that delete's operation id come back.
export async function restoreCapture(
  database: Database,
  captureId: string,
  opId: string,
  userId: string,
) {
  const restored = await restoreEntity<CaptureRow>(database, captures, captureId, opId, userId);
  if (!restored) return undefined;
  await database
    .update(captureSuggestions)
    .set({ deletedAt: null, deletedOpId: null, updatedAt: new Date() })
    .where(
      and(eq(captureSuggestions.captureId, captureId), eq(captureSuggestions.deletedOpId, opId)),
    );
  return restored;
}
// Interpretation replaces the drafts still waiting for review; reviewed ones stay as they are.
export async function replacePendingSuggestions(
  database: Database,
  captureId: string,
  opId: string,
  rows: (typeof captureSuggestions.$inferInsert)[],
) {
  const now = new Date();
  await database
    .update(captureSuggestions)
    .set({ deletedAt: now, deletedOpId: opId, updatedAt: now })
    .where(
      and(
        eq(captureSuggestions.captureId, captureId),
        eq(captureSuggestions.status, 'pending'),
        isNull(captureSuggestions.deletedAt),
      ),
    );
  if (rows.length) await database.insert(captureSuggestions).values(rows);
}

export type SuggestionRow = typeof captureSuggestions.$inferSelect;
// A draft with what its visibility is decided by: the capture's recorder and whether it is live.
export async function selectSuggestion(database: Database, suggestionId: string) {
  const [row] = await database
    .select({
      suggestion: captureSuggestions,
      createdBy: captures.createdBy,
      deletedAt: captures.deletedAt,
    })
    .from(captureSuggestions)
    .innerJoin(captures, eq(captures.id, captureSuggestions.captureId))
    .where(eq(captureSuggestions.id, suggestionId));
  return row;
}
// Approve all ready (S23): the reader's own drafts still waiting, inside the visibility predicate.
export async function selectOwnPendingSuggestions(database: Database, user: Reader) {
  return database
    .select({ id: captureSuggestions.id })
    .from(captureSuggestions)
    .innerJoin(captures, eq(captures.id, captureSuggestions.captureId))
    .where(
      and(
        visibleCaptures(user),
        eq(captures.createdBy, user.id),
        eq(captureSuggestions.status, 'pending'),
        isNull(captureSuggestions.deletedAt),
      ),
    )
    .orderBy(captureSuggestions.createdAt, captureSuggestions.id);
}
export async function updateSuggestion(
  database: Database,
  suggestionId: string,
  patch: Partial<typeof captureSuggestions.$inferInsert>,
) {
  await database
    .update(captureSuggestions)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(captureSuggestions.id, suggestionId));
}
