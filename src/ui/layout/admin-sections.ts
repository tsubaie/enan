import {
  DatabaseBackup,
  History,
  ListChecks,
  ListTodo,
  NotebookTabs,
  RefreshCw,
  SlidersHorizontal,
  Target,
  Users,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';
import { type AdminPage } from '@/core/routes';
// ADMIN-B40: one definition of the administration pages and their grouping, read by the side list
// on a wide screen and by the overview's index (ADMIN-B39), which is the same list on a phone.
// Groups follow what an administrator came to do: who is in the workspace and how it behaves,
// what notes and strategy are built from, and keeping the installation healthy.
export type AdminGroup = 'groupWorkspace' | 'groupContent' | 'groupMaintenance';
export const adminSections: {
  group: AdminGroup;
  pages: { page: AdminPage; icon: LucideIcon }[];
}[] = [
  {
    group: 'groupWorkspace',
    pages: [
      { page: 'settings', icon: SlidersHorizontal },
      { page: 'ai', icon: WandSparkles },
      { page: 'users', icon: Users },
    ],
  },
  {
    group: 'groupContent',
    pages: [
      { page: 'tasks', icon: ListTodo },
      { page: 'notes', icon: NotebookTabs },
      { page: 'objectives', icon: Target },
    ],
  },
  {
    group: 'groupMaintenance',
    pages: [
      { page: 'backups', icon: DatabaseBackup },
      { page: 'updates', icon: RefreshCw },
      { page: 'jobs', icon: ListChecks },
      { page: 'audit', icon: History },
    ],
  },
];
export const adminPages: AdminPage[] = adminSections.flatMap((section) =>
  section.pages.map((entry) => entry.page),
);
// The page an administration path shows, or null for the overview at /admin.
export function adminPageOf(path: string): AdminPage | null {
  const segment = path.split('/').filter(Boolean)[1];
  return adminPages.find((page) => page === segment) ?? null;
}
