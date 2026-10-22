import type { MetadataRoute } from 'next';
import { routes } from '@/core/routes';

// ADMIN-B52: without a manifest, iOS takes an installed web app's scope from the page it was added
// from (adding from /admin/users scopes it to /admin/), and shows every navigation outside that
// scope in an in-app Safari sheet. The whole origin is the app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: routes.root(),
    name: 'Enan',
    short_name: 'Enan',
    description: 'Self-hosted operating surface for executive offices',
    start_url: routes.root(),
    scope: routes.root(),
    display: 'standalone',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
