import { searchProvider } from './search';
import type { ServerManifest } from '@/core/modules/server-manifest';
import { homeSummary } from './home';
import { kinds, resolve } from './notifications';
export {
  getKpi,
  getKpiDetail,
  listKpis,
  createKpi,
  addReading,
  putTargets,
  listObjectives,
  createObjective,
} from './service';
export { homeSummary } from './home';
export const server: ServerManifest = {
  id: 'kpis',
  homeSummary,
  search: searchProvider,
  notifications: { kinds, resolve },
};
