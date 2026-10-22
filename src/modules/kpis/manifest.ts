import { Target } from 'lucide-react';
import type { ClientManifest } from '@/core/modules/manifest';
import { routes } from '@/core/routes';
// Imported from its own file rather than through `./ui`, so the shell carries the badge alone.
import { KpiCountBadge } from './ui/KpiCountBadge';
export const manifest: ClientManifest = {
  id: 'kpis',
  nav: {
    href: routes.kpis(),
    key: 'kpis',
    icon: Target,
    admin: false,
    order: 50,
    phoneOrder: 35,
    phoneKey: 'navKpisShort',
    badge: KpiCountBadge,
  },
};
