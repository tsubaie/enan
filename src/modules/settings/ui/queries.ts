import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { request, upload } from '@/core/http/client';
import { Setting, SettingWrite, UploadedWallpaper } from '../schema/validation';
export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => request('/admin/settings', z.object({ data: z.array(Setting) })),
  });
}
export function useSaveSetting() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: z.infer<typeof SettingWrite>) =>
      request('/admin/settings', z.object({ data: Setting }), { method: 'PATCH', body: input }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['settings'] }),
  });
}
// The people a principal can be chosen from, read from the directory's own list.
const PersonChoices = z.object({
  data: z.array(z.object({ id: z.string(), fullName: z.string() })),
});
export function usePersonChoices() {
  return useQuery({
    queryKey: ['people', 'list', 'settings-choices'],
    queryFn: () => request('/people?view=all&limit=200', PersonChoices),
  });
}
// ADMIN-B47: the images an administrator uploaded, an upload, and a delete. Deleting the chosen
// one resets the wallpaper setting, so the settings are read again after a delete.
export function useWallpapers() {
  return useQuery({
    queryKey: ['wallpapers'],
    queryFn: () => request('/admin/wallpapers', z.object({ data: z.array(UploadedWallpaper) })),
  });
}
export function useUploadWallpaper() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (form: FormData) =>
      upload('/admin/wallpapers', z.object({ data: UploadedWallpaper }), form),
    onSuccess: () => client.invalidateQueries({ queryKey: ['wallpapers'] }),
  });
}
const Removed = z.object({ data: z.object({ id: z.string(), wallpaper: z.string() }) });
export function useDeleteWallpaper() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request(`/admin/wallpapers/${id}`, Removed, { method: 'DELETE' }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['wallpapers'] });
      await client.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}
