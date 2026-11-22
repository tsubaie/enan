import type { ServerManifest } from '@/core/modules/server-manifest';
export { getCapture, pendingCaptureCount } from './service';
// No jobs, search or home section: captures never appear in notes lists or workspace search.
export const server: ServerManifest = { id: 'captures' };
