import type { ServerManifest } from '@/core/modules/server-manifest';
import { captureJobs } from './jobs';
export { getCapture, pendingCaptureCount } from './service';
// No search, notifications or home section: captures never appear in notes lists or workspace
// search, and nothing about them is notified (CAPTURES-B03).
export const server: ServerManifest = { id: 'captures', jobs: captureJobs };
