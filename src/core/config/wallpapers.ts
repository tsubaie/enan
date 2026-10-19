import { z } from 'zod';
import type { AccentTokens } from './wallpaper-accent';
// ADMIN-B42: the night theme's wallpaper, chosen by an administrator for the whole workspace.
// Each is a photograph served from public/wallpapers/<id>.jpg, because the security policy allows
// images from the app itself. ADR 0037 retired the drawn Indigo and the two light photographs (Fan,
// Mist); a saved choice of one of them no longer parses and is read as the default.
export const Wallpaper = z.enum([
  'ribbon',
  'copper',
  'jade',
  'neon',
  'folds',
  'stone',
  'arc',
  'sky',
]);
export type Wallpaper = z.infer<typeof Wallpaper>;
export const defaultWallpaper: Wallpaper = 'jade';
// ADMIN-B47: a wallpaper is light or dark, and the glass over a light one takes the menu's frost
// so the page and the menu read as one light sheet. The built-in photographs are all dark; an
// uploaded image carries the tone measured from its own pixels when it was uploaded.
export const WallpaperTone = z.enum(['light', 'dark']);
export type WallpaperTone = z.infer<typeof WallpaperTone>;
export const builtInTone: Record<Wallpaper, WallpaperTone> = {
  ribbon: 'dark',
  copper: 'dark',
  jade: 'dark',
  neon: 'dark',
  folds: 'dark',
  stone: 'dark',
  arc: 'dark',
  sky: 'dark',
};
// The average gamma-encoded luma (0 to 1) at or above which an image is light. Sky, the brightest
// built-in, measures about 0.3; the retired light photographs (Fan, Mist) measured about 0.9.
export const lightLuminance = 0.5;
export function toneOf(luminance: number): WallpaperTone {
  return luminance >= lightLuminance ? 'light' : 'dark';
}
// The workspace setting names a built-in wallpaper by its name, or an uploaded one by its id.
export const WallpaperChoice = z.union([Wallpaper, z.uuid()]);
export type WallpaperChoice = z.infer<typeof WallpaperChoice>;
// The types an uploaded wallpaper may be, recognised by their first bytes rather than their name.
export const WallpaperMime = z.enum(['image/jpeg', 'image/png', 'image/webp']);
export type WallpaperMime = z.infer<typeof WallpaperMime>;
// ADMIN-B47: what an upload must be. A header claiming more than `maxPixels` is refused before it
// is decoded; an image whose long edge is under `minLongEdge` looks poor stretched over a window;
// the stored image fits inside 4K and the picker shows a `thumbnailWidth` copy. At most
// `maxStored` images are kept, so uploads cannot fill the disk.
export const wallpaperImageLimits = {
  maxPixels: 48_000_000,
  minLongEdge: 1280,
  maxWidth: 3840,
  maxHeight: 2160,
  thumbnailWidth: 480,
  maxStored: 20,
};
// Each uploaded wallpaper is served at its own address; the image behind an id never changes, so
// the address can be cached for good.
export function wallpaperImagePath(id: string) {
  return `/api/v1/wallpapers/${id}`;
}
export function wallpaperThumbnailPath(id: string) {
  return `/api/v1/wallpapers/${id}/thumbnail`;
}
// An uploaded wallpaper's picked colour, as the browser measured it: #rrggbb, or null for none.
export const AccentColour = z
  .string()
  .regex(/^#[0-9a-f]{6}$/u)
  .nullable();
// What a page needs to draw the workspace's wallpaper: the name `tokens.css` draws (`custom` for
// an uploaded one), its tone, and for an uploaded one its image's address and the accent it gives
// the interface. A built-in wallpaper's accent is in tokens.css (ADR 0037), computed once by
// scripts/build/wallpaper-accents.ts.
export type WorkspaceWallpaper = {
  name: Wallpaper | 'custom';
  tone: WallpaperTone;
  image: string | null;
  accent: AccentTokens | null;
};
export function builtInWallpaper(name: Wallpaper): WorkspaceWallpaper {
  return { name, tone: builtInTone[name], image: null, accent: null };
}
