import type { ServerManifest } from '@/core/modules/server-manifest';
import { captureJobs } from './jobs';
export { getCapture, listCaptures, pendingCaptureCount } from './service';
export { readerCapture, requireRecording } from './setup';
// No search, notifications or home section: captures never appear in notes lists or workspace
// search, and nothing about them is notified (CAPTURES-B03).
export const server: ServerManifest = { id: 'captures', jobs: captureJobs };
