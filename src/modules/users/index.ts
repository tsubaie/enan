import type { ServerManifest } from '@/core/modules/server-manifest';
import { userJobs } from './jobs';
import { kinds, resolve } from './notifications';
export { setup, listUsers, patchUser, createUser } from './service';
export const server: ServerManifest = {
  id: 'users',
  jobs: userJobs,
  notifications: { kinds, resolve },
};
