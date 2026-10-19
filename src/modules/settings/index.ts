import type { ServerManifest } from '@/core/modules/server-manifest';
export { listSettings, updateSetting, workspaceWallpaper } from './service';
export const server: ServerManifest = { id: 'settings' };
