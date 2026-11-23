import { z } from 'zod';
import type { ApiError } from '@/core/http/client';
export type Refusal = 'tooLong' | 'tooLarge' | 'unsupportedType' | 'recordingOff';
const refusals = new Map<string, Refusal>([
  ['too_long', 'tooLong'],
  ['too_large', 'tooLarge'],
  ['unsupported_type', 'unsupportedType'],
  // CAPTURES-B14: either scope; the workspace's is the only one a reader can meet with a button.
  ['recording_off', 'recordingOff'],
]);
const Reason = z.object({ reason: z.string() });
// CAPTURES-B12: the server's reason (or code) for refusing the audio, said in the person's words.
export function refusalOf(error: ApiError): Refusal | null {
  const reason = Reason.safeParse(error.details).data?.reason ?? '';
  return refusals.get(reason) ?? refusals.get(error.code) ?? null;
}
