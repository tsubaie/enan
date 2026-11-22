import 'server-only';
import type { Context } from '@/core/auth/session';
import { assertCaptureAccess } from './access';
import { countPendingCaptures, selectCapture } from './repo';
import { Capture } from './schema/validation';
/**
 * Voice captures: a recording reviewed before anything goes live (ADR 0071).
 * Invariants protected here:
 * - CAPTURES-B02 a capture is read only by its recorder or an administrator; every other reader,
 *   like a missing or deleted id, gets `not_found` (`assertCaptureAccess`, `visibleCaptures`).
 * - CAPTURES-I01 captures never touch `note_voice_memos` or notes.
 */
export async function getCapture(ctx: Context, captureId: string) {
  return Capture.parse(assertCaptureAccess(ctx.user, await selectCapture(ctx.db, captureId)));
}
export async function pendingCaptureCount(ctx: Context) {
  return { pending: await countPendingCaptures(ctx.db, ctx.user) };
}
