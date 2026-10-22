import { describe, expect, it } from 'vitest';
import { isTransactional } from '@/core/db/transaction';
// Vite expands import.meta.glob when it transforms this file. Its type ships with vite/client, which
// the app does not reference, so the one form used here is declared for this test.
declare global {
  interface ImportMeta {
    glob(patterns: string[], options: { eager: true }): Record<string, object>;
  }
}
// Exports that only read, or that open their transaction themselves (setup takes a handle,
// manageTags predates the wrapper, and the wallpaper upload and delete do slow work outside it). Everything else a service exports writes and must be atomic.
const exempt: Record<string, string[]> = {
  account: ['getAccount', 'readerTheme', 'readerLocale'],
  committees: [
    'listCommittees',
    'getCommittee',
    'requireCommittee',
    'committeeChoices',
    'activity',
    'homeSummary',
  ],
  kpis: [
    'listKpis',
    'kpiFacets',
    'getKpi',
    'getKpiDetail',
    'listObjectives',
    'getObjective',
    'listReadings',
    'listTargets',
    'toKpi',
    'keyOf',
  ],
  home: ['homeSummary'],
  notes: [
    'viewsFor',
    'peopleForAi',
    'noteTypes',
    'listNotes',
    'getNote',
    'listTypes',
    'noteTemplates',
    'listTemplates',
    'listTags',
    'homeSummary',
    'listManagedTags',
    'manageTags',
  ],
  notifications: ['feed'],
  people: [
    'personNameSql',
    'assignablePeople',
    'listPeople',
    'listTags',
    'countPeople',
    'getPerson',
    'aiPeople',
    'personForUser',
    'userIdsForPeople',
  ],
  settings: [
    'listSettings',
    'workspaceWallpaper',
    'listWallpapers',
    'wallpaperImage',
    'uploadWallpaper',
    'deleteWallpaper',
  ],
  tasks: ['listTasks', 'getTask', 'peopleForAi'],
  users: ['setup', 'listUsers'],
};
// Every service surface is discovered, so a new module or a new AI file cannot be left out: each
// module's service.ts (keyed by the module name) and every file under its ai/ except the route
// handlers in api.ts (keyed by path).
const discovered = import.meta.glob(
  ['../../../modules/*/service.ts', '../../../modules/*/ai/*.ts', '!../../../modules/*/ai/api.ts'],
  { eager: true },
);
const surfaces = Object.entries(discovered).map(([path, exports]) => {
  const key = path
    .replace('../../../modules/', '')
    .replace(/\.ts$/u, '')
    .replace(/^([^/]+)\/service$/u, '$1');
  return [key, exports] as const;
});
describe('service transaction ownership', () => {
  it('ADMIN-B36 discovery covers every module service and its AI services', () => {
    const keys = surfaces.map(([key]) => key);
    expect(keys).toEqual(expect.arrayContaining(['tasks', 'tasks/ai/service', 'notes/ai/apply']));
  });
  it.each(surfaces)(
    'ADMIN-B36 every writing export of %s owns its transaction',
    (name, exports) => {
      const functions = Object.entries(exports).flatMap(([key, value]) =>
        typeof value === 'function' ? [[key, value] as const] : [],
      );
      const unwrapped = functions
        .filter(([key, value]) => !exempt[name]?.includes(key) && !isTransactional(value))
        .map(([key]) => key);
      expect(unwrapped).toEqual([]);
      const known = new Set(functions.map(([key]) => key));
      expect((exempt[name] ?? []).filter((key) => !known.has(key))).toEqual([]);
    },
  );
});
