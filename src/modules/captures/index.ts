import type { ServerManifest } from '@/core/modules/server-manifest';
import { captureJobs } from './jobs';
import { kinds, resolve } from './notifications';
export { getCapture, listCaptures, pendingCaptureCount } from './service';
export { readerCapture, requireRecording } from './setup';
// No search or home section: captures never appear in notes lists or workspace search. The only
// notifications are the recorder's own grouped ready line and failed lines (CAPTURES-B21).
export const server: ServerManifest = {
  id: 'captures',
  jobs: captureJobs,
  notifications: { kinds, resolve },
};
