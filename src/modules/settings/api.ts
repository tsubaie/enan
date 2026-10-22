import { z } from 'zod';
import { defineHandler, authenticated } from '@/core/http/handler';
import { currentUser } from '@/core/auth/session';
import { env } from '@/core/config/env';
import { WallpaperChoice } from '@/core/config/wallpapers';
import { SignInMethodsStatus, SignInMethodsWrite } from '@/core/config/sign-in-schema';
import { signInMethods } from '@/core/auth/methods';
import { Setting, SettingWrite, UploadedWallpaper, WallpaperUpload } from './schema/validation';
import {
  deleteWallpaper,
  listSettings,
  listWallpapers,
  updateSetting,
  uploadWallpaper,
  wallpaperImage,
} from './service';
export const list = defineHandler({
  guard: 'admin',
  input: z.strictObject({}),
  response: z.object({ data: z.array(Setting) }),
  handler: async (_, ctx) => ({ data: await listSettings(authenticated(ctx)) }),
});
export const update = defineHandler({
  guard: 'admin',
  input: SettingWrite,
  response: z.object({ data: Setting }),
  idempotent: true,
  handler: async (input, ctx) => ({
    data: await updateSetting(authenticated(ctx), input.key, input.value),
  }),
});
// ADMIN-B47: the uploaded wallpapers, an upload, and a delete.
export const wallpapers = defineHandler({
  guard: 'admin',
  input: z.strictObject({}),
  response: z.object({ data: z.array(UploadedWallpaper) }),
  handler: async (_, ctx) => ({ data: await listWallpapers(authenticated(ctx)) }),
});
// The declared body may exceed the image by the multipart framing around it.
const formOverhead = 64 * 1024;
export const wallpaperUpload = defineHandler({
  guard: 'admin',
  input: WallpaperUpload,
  source: 'form',
  maxBytes: () => env().WALLPAPER_MAX_MB * 1024 * 1024 + formOverhead,
  status: 201,
  response: z.object({ data: UploadedWallpaper }),
  handler: async (input, ctx) => ({ data: await uploadWallpaper(authenticated(ctx), input) }),
});
export const wallpaperRemove = defineHandler({
  guard: 'admin',
  input: z.strictObject({}),
  response: z.object({ data: z.object({ id: z.uuid(), wallpaper: WallpaperChoice }) }),
  handler: async (_, ctx, params) => ({
    data: await deleteWallpaper(authenticated(ctx), z.uuid().parse(params.id)),
  }),
});
// The image itself and its thumbnail, for every signed-in member, since every page is drawn on
// it. They are files, not JSON, so they are answered here rather than through defineHandler. An id
// names one image for good, so the browser may keep it for a year without asking again; the
// security headers every response carries come from the proxy (ADMIN-B34).
function imageFile(size: 'full' | 'thumbnail') {
  return async (_request: Request, route: { params: Promise<Record<string, string>> }) => {
    const user = await currentUser({ slide: false });
    if (!user) return Response.json({ error: { code: 'unauthenticated' } }, { status: 401 });
    const image = await wallpaperImage((await route.params).id ?? '', size);
    if (!image) return Response.json({ error: { code: 'not_found' } }, { status: 404 });
    return new Response(new Uint8Array(image.bytes), {
      headers: {
        'Content-Type': image.mime,
        'Content-Length': String(image.bytes.byteLength),
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  };
}
export const wallpaperImageFile = imageFile('full');
export const wallpaperThumbnailFile = imageFile('thumbnail');
// ADMIN-B64: the ways in an administrator may offer, which the server can serve, and which are on.
export const signIn = defineHandler({
  guard: 'admin',
  input: z.strictObject({}),
  response: z.object({ data: SignInMethodsStatus }),
  handler: async (_, ctx) => ({ data: await signInMethods(ctx.db) }),
});
export const signInSave = defineHandler({
  guard: 'admin',
  input: SignInMethodsWrite,
  response: z.object({ data: SignInMethodsStatus }),
  idempotent: true,
  handler: async (input, ctx) => {
    await updateSetting(authenticated(ctx), 'auth.sign_in_methods', input.methods);
    return { data: await signInMethods(ctx.db) };
  },
});
