import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { crc32 } from 'node:zlib';
import { and, eq, isNull } from 'drizzle-orm';
import { closeDatabase, db } from '@/core/db/client';
import { clearDatabase } from '@/core/db/reset';
import { migrateDatabase } from '@/core/db/migrate';
import { env } from '@/core/config/env';
import { insertUser } from '@/core/db/auth-repo';
import { auditLog, files, settings } from '@/core/db/system-schema';
import { readStoredFile, removePartialFiles } from '@/core/files/storage';
import { names, writeTree } from '@/core/backup/tests/fixtures/archive';
import { insertWallpaper } from '../repo';
import { User } from '@/core/http/user-schema';
import { id } from '@/core/db/ids';
import sharp from 'sharp';
import { accentProperties, accentTokens, rgbToHex } from '@/core/config/wallpaper-accent';
import { wallpaperImageLimits } from '@/core/config/wallpapers';
import { wallpapers } from '../schema/db';
import { workspaceWallpaper } from '../service';
import * as api from '../api';
// ADMIN-B47: the wallpaper handlers as their routes export them, with real multipart requests
// against the real database and the test files directory. The session is the one seam replaced.
const session = vi.hoisted(() => ({ user: null as User | null }));
vi.mock('@/core/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/auth/session')>()),
  currentUser: async () => session.user,
}));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
// The real decoder, announcing when it starts, so a test can act while an upload is decoding.
const decoder = vi.hoisted(() => ({ started: () => {} }));
vi.mock('@/core/files/wallpaper-image', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/core/files/wallpaper-image')>();
  return {
    ...real,
    processWallpaperImage: (...args: Parameters<typeof real.processWallpaperImage>) => {
      decoder.started();
      return real.processWallpaperImage(...args);
    },
  };
});
// Real images, made here: a still frame of one colour, optionally with EXIF (GPS included).
const frame = (width: number, height: number, rgb = { r: 40, g: 90, b: 230 }) =>
  sharp({ create: { width, height, channels: 3, background: rgb } });
let jpeg: Uint8Array;
let png: Uint8Array;
let bright: Uint8Array;
beforeAll(async () => {
  jpeg = new Uint8Array(
    await frame(1600, 1000)
      .withExif({
        IFD0: { Copyright: 'Uploader', ImageDescription: 'home' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '24/1 42/1 0/1' },
      })
      .jpeg()
      .toBuffer(),
  );
  png = new Uint8Array(await frame(1400, 900, { r: 10, g: 140, b: 130 }).png().toBuffer());
  bright = new Uint8Array(await frame(1600, 1000, { r: 240, g: 240, b: 245 }).png().toBuffer());
});
type Fields = { bytes: Uint8Array; name?: string; extra?: Record<string, string> };
// A multipart body as a browser sends it: the boundary in the type and the length declared.
async function form({ bytes, name = 'Desert dusk.jpg', extra = {} }: Fields) {
  const body = new FormData();
  body.set('file', new File([new Uint8Array(bytes)], name));
  for (const [key, value] of Object.entries(extra)) body.set(key, value);
  const encoded = new Response(body);
  const raw = new Uint8Array(await encoded.arrayBuffer());
  return { raw, type: encoded.headers.get('content-type') ?? '' };
}
const headers = (extra: Record<string, string> = {}) => ({
  Origin: env().APP_URL,
  'X-Requested-With': 'Enan',
  'Idempotency-Key': crypto.randomUUID(),
  ...extra,
});
async function upload(fields: Fields, declared?: number) {
  const { raw, type } = await form(fields);
  const request = new Request(new URL('/api/v1/admin/wallpapers', env().APP_URL), {
    method: 'POST',
    headers: headers({
      'Content-Type': type,
      'Content-Length': String(declared ?? raw.byteLength),
    }),
    body: raw,
  });
  const response = await api.wallpaperUpload(request);
  return { status: response.status, body: await response.json() };
}
const route = (wallpaperId: string) => ({ params: Promise.resolve({ id: wallpaperId }) });
async function remove(wallpaperId: string) {
  const request = new Request(new URL(`/api/v1/admin/wallpapers/${wallpaperId}`, env().APP_URL), {
    method: 'DELETE',
    headers: headers({ 'Content-Type': 'application/json' }),
  });
  const response = await api.wallpaperRemove(request, route(wallpaperId));
  return { status: response.status, body: await response.json() };
}
async function choose(value: string) {
  const request = new Request(new URL('/api/v1/admin/settings', env().APP_URL), {
    method: 'PATCH',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ key: 'workspace.wallpaper', value }),
  });
  const response = await api.update(request);
  return { status: response.status, body: await response.json() };
}
const thumbnail = (wallpaperId: string) =>
  api.wallpaperThumbnailFile(
    new Request(new URL(`/api/v1/wallpapers/${wallpaperId}/thumbnail`, env().APP_URL)),
    route(wallpaperId),
  );
const image = (wallpaperId: string) =>
  api.wallpaperImageFile(
    new Request(new URL(`/api/v1/wallpapers/${wallpaperId}`, env().APP_URL)),
    route(wallpaperId),
  );
const chosen = async () =>
  (
    await db()
      .select()
      .from(settings)
      .where(and(eq(settings.key, 'workspace.wallpaper'), isNull(settings.userId)))
  )[0]?.value;
const exists = (key: string) =>
  readStoredFile(key).then(
    () => true,
    () => false,
  );
let admin: User;
let member: User;
beforeAll(() => migrateDatabase());
beforeEach(async () => {
  await clearDatabase();
  admin = User.parse(
    await insertUser(db(), {
      id: id(),
      name: 'Admin',
      email: 'admin@example.test',
      passwordHash: 'x',
      role: 'admin',
    }),
  );
  member = User.parse(
    await insertUser(db(), {
      id: id(),
      name: 'Member',
      email: 'member@example.test',
      passwordHash: 'x',
      role: 'member',
    }),
  );
  session.user = admin;
});
afterAll(() => closeDatabase());
const stored = async (wallpaperId: string) =>
  new Uint8Array(await (await image(wallpaperId)).arrayBuffer());

it('ADMIN-B47 an upload is re-encoded to WebP with no metadata, and audited', async () => {
  expect((await sharp(jpeg).metadata()).exif).toBeDefined();
  const created = await upload({ bytes: jpeg });
  expect(created.status).toBe(201);
  expect(created.body.data).toMatchObject({
    name: 'Desert dusk',
    image: `/api/v1/wallpapers/${created.body.data.id}`,
    thumbnail: `/api/v1/wallpapers/${created.body.data.id}/thumbnail`,
  });
  const bytes = await stored(created.body.data.id);
  const meta = await sharp(bytes).metadata();
  expect(meta).toMatchObject({ format: 'webp', width: 1600, height: 1000 });
  expect(meta.exif).toBeUndefined();
  expect(meta.icc).toBeUndefined();
  expect(meta.xmp).toBeUndefined();
  expect(Buffer.from(bytes).includes('Uploader')).toBe(false);
  const rows = await db().select().from(files);
  expect(rows.map((row) => row.mime)).toEqual(['image/webp', 'image/webp']);
  expect(rows.every((row) => /^wallpaper-[0-9a-f-]{36}$/u.test(row.storageKey))).toBe(true);
  const audit = await db().select().from(auditLog).where(eq(auditLog.entityType, 'wallpaper'));
  expect(audit).toMatchObject([
    { action: 'create', entityId: created.body.data.id, actorId: admin.id },
  ]);
  const listed = await api.wallpapers(
    new Request(new URL('/api/v1/admin/wallpapers', env().APP_URL)),
  );
  expect((await listed.json()).data).toHaveLength(1);
});

it('ADMIN-B47 a large image is fitted inside 4K and a 480-pixel thumbnail is made', async () => {
  const big = new Uint8Array(await frame(5000, 2500).jpeg().toBuffer());
  const created = await upload({ bytes: big });
  expect(await sharp(await stored(created.body.data.id)).metadata()).toMatchObject({
    width: 3840,
    height: 1920,
  });
  const small = await thumbnail(created.body.data.id);
  expect(small.headers.get('Content-Type')).toBe('image/webp');
  expect(await sharp(new Uint8Array(await small.arrayBuffer())).metadata()).toMatchObject({
    format: 'webp',
    width: wallpaperImageLimits.thumbnailWidth,
  });
});

it('ADMIN-B47 tone and accent are measured on the server; the browser cannot send them', async () => {
  const dark = await upload({ bytes: png });
  expect(dark.body.data.tone).toBe('dark');
  expect(dark.body.data.accent).toMatch(/^#[0-9a-f]{6}$/u);
  const light = await upload({ bytes: bright });
  expect(light.body.data).toMatchObject({ tone: 'light', accent: null });
  const forged = await upload({ bytes: png, extra: { luminance: '1', accent: rgbToHex([255, 0, 0]) } });
  expect(forged.status).toBe(400);
});

it('ADMIN-B47 a member cannot upload, list or delete wallpapers', async () => {
  const created = await upload({ bytes: png });
  session.user = member;
  expect((await upload({ bytes: png })).status).toBe(403);
  const listed = await api.wallpapers(
    new Request(new URL('/api/v1/admin/wallpapers', env().APP_URL)),
  );
  expect(listed.status).toBe(403);
  expect((await remove(created.body.data.id)).status).toBe(403);
  expect(await db().select().from(wallpapers)).toHaveLength(1);
});

it('ADMIN-B47 the type is read from the bytes: a renamed file or a GIF in disguise is refused', async () => {
  const text = new TextEncoder().encode('not an image at all');
  const refused = await upload({ bytes: text, name: 'photo.jpg' });
  expect(refused.status).toBe(422);
  expect(refused.body.error).toMatchObject({
    code: 'rule_violation',
    details: { reason: 'unsupported_type' },
  });
  const gif = new Uint8Array(await frame(1600, 1000).gif().toBuffer());
  expect((await upload({ bytes: gif, name: 'photo.webp' })).body.error).toMatchObject({
    details: { reason: 'unsupported_type' },
  });
  expect(await db().select().from(files)).toHaveLength(0);
});

it('ADMIN-B47 an animated image is refused', async () => {
  const frames = await Promise.all([
    frame(1600, 1000).png().toBuffer(),
    frame(1600, 1000, { r: 200, g: 0, b: 0 }).png().toBuffer(),
  ]);
  const animated = new Uint8Array(
    await sharp(frames, { join: { animated: true } })
      .webp()
      .toBuffer(),
  );
  const refused = await upload({ bytes: animated, name: 'loop.webp' });
  expect(refused.status).toBe(422);
  expect(refused.body.error).toMatchObject({ details: { reason: 'animated' } });
});

it('ADMIN-B47 a pixel bomb is refused from its header, before it is decoded', async () => {
  // A small PNG whose header claims 20 000 × 20 000 pixels, with the header's checksum made good.
  const bomb = new Uint8Array(png);
  const view = new DataView(bomb.buffer);
  view.setUint32(16, 20000);
  view.setUint32(20, 20000);
  view.setUint32(29, crc32(bomb.subarray(12, 29)));
  const refused = await upload({ bytes: bomb, name: 'bomb.png' });
  expect(refused.status).toBe(422);
  expect(refused.body.error).toMatchObject({ details: { reason: 'too_many_pixels' } });
});

it('ADMIN-B47 an image too small for a wallpaper is refused', async () => {
  const tiny = new Uint8Array(await frame(800, 600).png().toBuffer());
  const refused = await upload({ bytes: tiny });
  expect(refused.status).toBe(422);
  expect(refused.body.error).toMatchObject({
    details: { reason: 'too_small', minLongEdge: wallpaperImageLimits.minLongEdge },
  });
});

it('ADMIN-B47 an image over the configured size is refused before it is read', async () => {
  const limit = env().WALLPAPER_MAX_MB * 1024 * 1024;
  const refused = await upload({ bytes: png }, limit + 128 * 1024);
  expect(refused.status).toBe(422);
  expect(refused.body.error).toMatchObject({ details: { reason: 'too_large' } });
  const big = new Uint8Array(limit + 1);
  big.set(png);
  const oversized = await upload({ bytes: big });
  expect(oversized.status).toBe(422);
  expect(oversized.body.error).toMatchObject({ details: { reason: 'too_large' } });
  expect(await db().select().from(wallpapers)).toHaveLength(0);
});

it('ADMIN-B47 at most the configured number of images is kept', async () => {
  for (let i = 0; i < wallpaperImageLimits.maxStored; i += 1) {
    const file = () => ({
      id: id(),
      storageKey: `wallpaper-${id()}`,
      mime: 'image/webp',
      sizeBytes: 1,
      sha256: 'x',
    });
    await insertWallpaper(db(), {
      id: id(),
      name: `n${i}`,
      tone: 'dark',
      accent: null,
      createdBy: admin.id,
      image: file(),
      thumbnail: file(),
    });
  }
  const refused = await upload({ bytes: png });
  expect(refused.status).toBe(422);
  expect(refused.body.error).toMatchObject({
    details: { reason: 'limit_reached', max: wallpaperImageLimits.maxStored },
  });
});

it('ADMIN-B47 the image is served to a signed-in member as inline WebP with a year-long immutable cache', async () => {
  const created = await upload({ bytes: png });
  session.user = member;
  const served = await image(created.body.data.id);
  expect(served.status).toBe(200);
  expect(served.headers.get('Content-Type')).toBe('image/webp');
  expect(served.headers.get('Content-Disposition')).toBe('inline');
  expect(served.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(served.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable');
  session.user = null;
  expect((await image(created.body.data.id)).status).toBe(401);
  expect((await thumbnail(created.body.data.id)).status).toBe(401);
  session.user = member;
  expect((await image(id())).status).toBe(404);
});

it('ADMIN-B47 choosing an upload draws it with its tone and accent; an unknown id cannot be chosen', async () => {
  const created = await upload({ bytes: png });
  expect((await choose(id())).status).toBe(422);
  expect((await choose(created.body.data.id)).status).toBe(200);
  const drawn = await workspaceWallpaper();
  const accent = accentTokens(created.body.data.accent);
  expect(drawn).toEqual({
    name: 'custom',
    tone: 'dark',
    image: `/api/v1/wallpapers/${created.body.data.id}`,
    accent,
  });
  // What the root layout puts on <html> for tokens.css to apply per theme.
  expect(accentProperties(drawn.accent ?? accentTokens(null))).toMatchObject({
    '--wallpaper-accent-night': accent.night.accent,
    '--wallpaper-accent-paper': accent.paper.accent,
  });
});

it('ADMIN-B47 delete removes the rows and both binaries; deleting the chosen image puts the default back', async () => {
  const kept = await upload({ bytes: png, name: 'kept.png' });
  const created = await upload({ bytes: jpeg });
  await choose(created.body.data.id);
  const owned = await db().select().from(files).where(eq(files.originalName, 'Desert dusk'));
  expect(owned).toHaveLength(2);
  const removed = await remove(created.body.data.id);
  expect(removed.status).toBe(200);
  expect(removed.body.data).toEqual({ id: created.body.data.id, wallpaper: 'jade' });
  expect(await chosen()).toBe('jade');
  expect((await workspaceWallpaper()).name).toBe('jade');
  expect(await db().select().from(wallpapers)).toMatchObject([{ id: kept.body.data.id }]);
  expect(await db().select().from(files).where(eq(files.originalName, 'Desert dusk'))).toHaveLength(
    0,
  );
  for (const file of owned) expect(await exists(file.storageKey)).toBe(false);
  const audit = await db().select().from(auditLog).where(eq(auditLog.entityType, 'wallpaper'));
  expect(audit.map((row) => row.action).sort()).toEqual(['create', 'create', 'delete']);
  expect((await remove(created.body.data.id)).status).toBe(404);
  // Deleting one that is not chosen leaves the choice alone.
  await choose('sky');
  expect((await remove(kept.body.data.id)).body.data.wallpaper).toBe('sky');
});

it('ADMIN-B47 an upload decodes outside the write lock: a save made meanwhile is not held up', async () => {
  const large = new Uint8Array(await frame(3800, 2400).png().toBuffer());
  const finished: string[] = [];
  const decoding = new Promise<void>((resolve) => (decoder.started = resolve));
  const uploading = upload({ bytes: large }).then((result) => (finished.push('upload'), result));
  await decoding;
  const saving = choose('sky').then((result) => (finished.push('save'), result));
  expect((await saving).status).toBe(200);
  expect((await uploading).status).toBe(201);
  expect(finished).toEqual(['save', 'upload']);
});

it('ADMIN-B47 two uploads racing for the last place: one is refused and leaves no file behind', async () => {
  for (let i = 0; i < wallpaperImageLimits.maxStored - 1; i += 1) {
    const file = () => ({
      id: id(),
      storageKey: `wallpaper-${id()}`,
      mime: 'image/webp',
      sizeBytes: 1,
      sha256: 'x',
    });
    await insertWallpaper(db(), {
      id: id(),
      name: `n${i}`,
      tone: 'dark',
      accent: null,
      createdBy: admin.id,
      image: file(),
      thumbnail: file(),
    });
  }
  const before = await names(env().FILES_DIR).catch((): string[] => []);
  const results = await Promise.all([upload({ bytes: png }), upload({ bytes: jpeg })]);
  expect(results.map((result) => result.status).sort()).toEqual([201, 422]);
  const added = (await names(env().FILES_DIR)).filter((name) => !before.includes(name));
  const owned = await db().select().from(files);
  expect(added.sort()).toEqual(
    owned
      .map((file) => file.storageKey)
      .filter((key) => added.includes(key))
      .sort(),
  );
  expect(added).toHaveLength(2);
});

it('ADMIN-B47 a temporary file a crash left is removed at the next start', async () => {
  const leftover = `.wallpaper-${id()}.partial`;
  await writeTree(env().FILES_DIR, { [leftover]: 'half' });
  await removePartialFiles();
  expect(await names(env().FILES_DIR)).not.toContain(leftover);
});

it('ADMIN-B42 a saved choice of a retired wallpaper (Indigo, Fan, Mist) is read as the default, Jade', async () => {
  for (const retired of ['indigo', 'fan', 'mist']) {
    await db().delete(settings).where(eq(settings.key, 'workspace.wallpaper'));
    await db()
      .insert(settings)
      .values({
        key: 'workspace.wallpaper',
        value: retired,
        scope: 'workspace',
        userId: null,
        updatedBy: admin.id,
      });
    expect(await workspaceWallpaper()).toEqual({
      name: 'jade',
      tone: 'dark',
      image: null,
      accent: null,
    });
    expect((await choose(retired)).status).toBe(400);
  }
});
