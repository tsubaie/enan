// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import en from '@/core/i18n/messages/en.json';
import ar from '@/core/i18n/messages/ar.json';
import type { UploadedWallpaper } from '../../schema/validation';
import { WallpaperPicker } from '../../ui/WallpaperPicker';
import { mount } from './harness';
// ADMIN-B42, ADMIN-B47: the picker's tiles. The query hooks are the seam: each scenario hands in
// the uploaded wallpapers and watches what the tiles ask to save, upload or delete.
const state = vi.hoisted(() => ({
  save: vi.fn(),
  remove: vi.fn(),
  upload: vi.fn(),
  refresh: vi.fn(),
  wallpapers: [] as UploadedWallpaper[],
  listError: null as Error | null,
}));
vi.mock('../../ui/queries', () => ({
  useSaveSetting: () => ({ mutate: state.save, isPending: false, isError: false }),
  useWallpapers: () => ({
    data: state.listError ? undefined : { data: state.wallpapers },
    error: state.listError,
    refetch: vi.fn(),
  }),
  useDeleteWallpaper: () => ({ mutate: state.remove, isPending: false, error: null }),
  useUploadWallpaper: () => ({ mutate: state.upload, isPending: false, error: null }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.refresh }) }));
const dusk: UploadedWallpaper = {
  id: '0199f000-0000-7000-8000-000000000001',
  name: 'Desert dusk',
  tone: 'dark',
  accent: null,
  image: '/api/v1/wallpapers/0199f000-0000-7000-8000-000000000001',
  thumbnail: '/api/v1/wallpapers/0199f000-0000-7000-8000-000000000001/thumbnail',
  createdAt: '2026-10-18T10:00:00.000Z',
};
beforeEach(() => {
  state.save = vi.fn();
  state.remove = vi.fn();
  state.upload = vi.fn();
  state.wallpapers = [dusk];
  state.listError = null;
});
describe.each(['en', 'ar'] as const)('%s', (locale) => {
  const m = locale === 'ar' ? ar : en;
  it(`ADMIN-B47 uploaded images are tiles of their own pictures beside the built-ins, with an upload tile ${locale}`, () => {
    const { container } = mount(<WallpaperPicker value={dusk.id} />, locale);
    const builtIn = screen.getByRole('radiogroup', { name: m.admin.wallpaper });
    expect(within(builtIn).getAllByRole('radio')).toHaveLength(8);
    expect(
      within(builtIn)
        .getByRole('radio', { name: m.admin.wallpaper_jade })
        .getAttribute('aria-checked'),
    ).toBe('false');
    const yours = screen.getByRole('radiogroup', { name: m.admin.wallpaperYours });
    const tile = within(yours).getByRole('radio', { name: 'Desert dusk' });
    expect(tile.getAttribute('aria-checked')).toBe('true');
    expect(tile.querySelector('img')?.getAttribute('src')).toBe(dusk.thumbnail);
    expect(screen.getByRole('button', { name: m.admin.wallpaperUpload })).toBeTruthy();
    const input = container.querySelector('input[type="file"]');
    expect(input?.getAttribute('accept')).toBe('image/jpeg,image/png,image/webp');
  });
  it(`ADMIN-B47 choosing an uploaded image saves its id as the workspace wallpaper ${locale}`, () => {
    mount(<WallpaperPicker value="jade" />, locale);
    fireEvent.click(screen.getByRole('radio', { name: 'Desert dusk' }));
    expect(state.save.mock.lastCall?.[0]).toEqual({ key: 'workspace.wallpaper', value: dusk.id });
  });
  it(`ADMIN-B47 delete asks first, says when the image is in use, and deletes only on confirm ${locale}`, () => {
    mount(<WallpaperPicker value={dusk.id} />, locale);
    fireEvent.click(
      screen.getByRole('button', {
        name: m.admin.wallpaperDelete.replace('{name}', 'Desert dusk'),
      }),
    );
    expect(screen.getByText(m.admin.wallpaperDeleteChosen)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: m.admin.wallpaperKeep }));
    expect(state.remove).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', {
        name: m.admin.wallpaperDelete.replace('{name}', 'Desert dusk'),
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: m.admin.wallpaperDeleteAction }));
    expect(state.remove).toHaveBeenCalledWith(dusk.id);
  });
  it(`ADMIN-B47 built-in wallpapers have no delete button ${locale}`, () => {
    state.wallpapers = [];
    mount(<WallpaperPicker value="jade" />, locale);
    expect(screen.queryByRole('radiogroup', { name: m.admin.wallpaperYours })).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete|حذف/u })).toBeNull();
  });
  it(`ADMIN-B47 when the images cannot be loaded the page says so and offers no upload ${locale}`, () => {
    state.listError = new Error('no such table');
    mount(<WallpaperPicker value="jade" />, locale);
    expect(screen.getByText(m.admin.wallpaperYoursError)).toBeTruthy();
    expect(screen.queryByRole('button', { name: m.admin.wallpaperUpload })).toBeNull();
    expect(screen.getAllByRole('radio')).toHaveLength(8);
  });
});
