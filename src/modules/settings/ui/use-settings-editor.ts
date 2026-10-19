'use client';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useToastManager } from '@/ui/primitives/toast';
import { useSettings, useSaveSetting } from './queries';
import type { Save } from './SettingControls';
// Numerals, the default language, the time zone and the wallpaper are applied when a page is
// rendered on the server, so a change to one of them re-renders the page to show it at once.
const rendered = new Set([
  'workspace.arabic_numerals',
  'workspace.default_locale',
  'workspace.name',
  'workspace.timezone',
  'workspace.wallpaper',
]);
// The workspace settings and one way to change them, shared by every page that edits some of them
// (Settings, Tasks, Objectives): each change saves at once and is confirmed by the shared toast.
export function useSettingsEditor() {
  const c = useTranslations('common');
  const query = useSettings();
  const mutation = useSaveSetting();
  const toasts = useToastManager();
  const router = useRouter();
  const rows = query.data?.data ?? [];
  const row = (key: string) => rows.find((setting) => setting.key === key);
  const save: Save = (input) =>
    mutation.mutate(input, {
      onSuccess: () => {
        toasts.add({ title: c('saved') });
        if (rendered.has(input.key)) router.refresh();
      },
    });
  return { query, row, save, error: mutation.error };
}
