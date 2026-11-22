import 'server-only';
import { type Claimed } from '@/core/db/jobs-repo';
import { AppError } from '@/core/http/errors';
import { readStoredFile } from '@/core/files/storage';
import { audioFormat } from '@/core/files/voice-audio';
import { executeTranscription } from './execute';
// ADR 0070: speech to text for a stored recording, shared by voice memos and captures. It only
// answers with the text; what the text is written onto is the calling job's business.
export async function transcribeStoredAudio(
  job: Claimed,
  audio: { storageKey: string; mime: string } | undefined,
  signal: AbortSignal,
) {
  const format = audio ? audioFormat(audio.mime) : null;
  if (!audio || !format) throw new AppError('ai_failed', { reason: 'missing_audio' });
  const bytes = await readStoredFile(audio.storageKey);
  const transcript = (await executeTranscription(job, { bytes, format }, signal)).trim();
  if (!transcript) throw new AppError('ai_failed', { reason: 'no_speech' });
  return transcript;
}
