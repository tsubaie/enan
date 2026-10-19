import { z } from 'zod';
import { AccentColour } from '@/core/config/wallpapers';
export const Setting = z.object({
  key: z.string(),
  value: z.json(),
  default: z.json(),
  type: z.string(),
});
export const SettingWrite = z.strictObject({ key: z.string(), value: z.json() });
// ADMIN-B47: an uploaded wallpaper as the picker shows it, and the upload form (the image alone).
// Its tone and accent (ADR 0037) are measured on the server from the decoded pixels.
export const UploadedWallpaper = z.object({
  id: z.uuid(),
  name: z.string(),
  tone: z.enum(['light', 'dark']),
  accent: AccentColour,
  image: z.string(),
  thumbnail: z.string(),
  createdAt: z.string(),
});
export type UploadedWallpaper = z.infer<typeof UploadedWallpaper>;
export const WallpaperUpload = z.strictObject({ file: z.file() });
