import { Settings } from 'lucide-react';
import type { ClientManifest } from '@/core/modules/manifest';
import { routes } from '@/core/routes';
// The administration area is entered through its overview (ADMIN-B39); its pages are core-owned surfaces.
export const manifest: ClientManifest = {
  id: 'users',
  nav: { href: routes.adminHome(), key: 'admin', icon: Settings, admin: true, order: 90 },
};
