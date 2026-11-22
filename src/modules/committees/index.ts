import { searchProvider } from './search';
import type { ServerManifest } from '@/core/modules/server-manifest';
import { homeSummary } from './service';
export { requireCommittee, getCommittee, committeeChoices, homeSummary } from './service';
export const server: ServerManifest = { id: 'committees', homeSummary, search: searchProvider };
