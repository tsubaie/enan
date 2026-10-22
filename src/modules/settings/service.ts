/**
 * ADMIN-B07: registry validation and workspace role allowlists.
 * ADMIN-B42: every page reads the workspace wallpaper while it renders; an unreadable database
 * falls back to the default.
 * ADMIN-B47: administrators upload and delete their own wallpaper images. An upload is checked by
 * its size and first bytes, then decoded and re-encoded so only its pixels are stored; the wallpaper setting can only name an
 * image that exists; deleting the chosen image puts the default back in the same transaction.
 */
import 'server-only';
import { transactional } from '@/core/db/transaction';
import { z } from 'zod';
import { settingsRegistry, isSettingKey, type SettingKey } from '@/core/config/settings';
import { getSetting, readSettings, writeSetting } from '@/core/db/settings-repo';
import { db, withTransaction } from '@/core/db/client';
import { createHash } from 'node:crypto';
import {
  Wallpaper,
  WallpaperChoice,
  WallpaperTone,
  builtInWallpaper,
  defaultWallpaper,
  wallpaperImageLimits,
  wallpaperImagePath,
  wallpaperThumbnailPath,
  type WorkspaceWallpaper,
} from '@/core/config/wallpapers';
import { env } from '@/core/config/env';
import { accentTokens } from '@/core/config/wallpaper-accent';
import { imageTypeOf } from '@/core/files/image-type';
import { processWallpaperImage } from '@/core/files/wallpaper-image';
import { readStoredFile, removeStoredFile, writeStoredFile } from '@/core/files/storage';
import { id } from '@/core/db/ids';
import type { Database } from '@/core/db/client';
import {
  countWallpapers,
  deleteWallpaperRows,
  insertWallpaper,
  selectWallpaperById,
  selectWallpapers,
  type WallpaperRow,
} from './repo';
import { lockWorkspace } from '@/core/db/auth-repo';
import { writeAudit } from '@/core/db/audit-repo';
import type { Context } from '@/core/auth/session';
import { AppError } from '@/core/http/errors';
import { requireAvailable } from '@/core/auth/methods';
import { SignInMethods } from '@/core/config/sign-in-schema';
export async function listSettings(ctx: Context) {
  if (ctx.user.role !== 'admin') throw new AppError('forbidden');
  const saved = await readSettings(ctx.db);
  return Object.entries(settingsRegistry)
    .filter(([, item]) => item.scope === 'workspace')
    .map(([key, item]) => ({
      key,
      value: z
        .json()
        .parse(
          item.schema.parse(
            saved.find((row) => row.key === key && row.userId === null)?.value ?? item.default,
          ),
        ),
      default: z.json().parse(item.default),
      type: item.schema.def.type,
    }));
}
export const updateSetting = transactional(async function updateSetting(
  ctx: Context,
  key: string,
  value: z.infer<ReturnType<typeof z.json>>,
) {
  if (!isSettingKey(key)) throw new AppError('validation_failed');
  const item = settingsRegistry[key];
  if (item.scope !== 'workspace' || !item.writeRoles.includes(ctx.user.role))
    throw new AppError('forbidden');
  await lockWorkspace(ctx.db);
  const parsed = z.json().parse(item.schema.parse(value));
  if (key === 'workspace.wallpaper') await requireWallpaperChoice(ctx.db, parsed);
  if (key === 'auth.sign_in_methods') await requireAvailable(ctx.db, SignInMethods.parse(parsed));
  await writeWorkspaceSetting(ctx, key, parsed);
  await writeAudit(ctx.db, ctx.user.id, 'update', 'setting', null, { key, value: parsed });
  return { key, value: parsed, default: z.json().parse(item.default), type: item.schema.def.type };
});
// The registry already validated `value`; this narrows the generic write for a runtime key.
function writeWorkspaceSetting(
  ctx: Context,
  key: SettingKey,
  value: z.infer<ReturnType<typeof z.json>>,
) {
  return writeSetting(ctx.db, key, z.custom<never>().parse(value), ctx.user.id);
}
// ADMIN-B47: the setting may name a built-in wallpaper or an uploaded one that still exists.
async function requireWallpaperChoice(database: Database, value: unknown) {
  if (Wallpaper.safeParse(value).success) return;
  const choice = z.uuid().safeParse(value);
  if (!choice.success || !(await selectWallpaperById(database, choice.data)))
    throw new AppError('rule_violation', { reason: 'unknown_wallpaper' });
}
// ADMIN-B42, ADMIN-B47: the wallpaper every page is drawn on, read while the page renders. An
// uploaded image that is gone draws the default, and a database that cannot be read yet (first
// start, sign-in before migration) falls back to the default rather than failing the page.
export async function workspaceWallpaper(): Promise<WorkspaceWallpaper> {
  try {
    const choice = await getSetting(db(), 'workspace.wallpaper');
    const builtIn = Wallpaper.safeParse(choice);
    if (builtIn.success) return builtInWallpaper(builtIn.data);
    const row = await selectWallpaperById(db(), choice);
    if (!row) return builtInWallpaper(defaultWallpaper);
    return {
      name: 'custom',
      tone: WallpaperTone.parse(row.tone),
      image: wallpaperImagePath(row.id),
      accent: accentTokens(row.accent),
    };
  } catch {
    return builtInWallpaper(defaultWallpaper);
  }
}
function shown(row: WallpaperRow) {
  return {
    id: row.id,
    name: row.name,
    tone: WallpaperTone.parse(row.tone),
    accent: row.accent,
    image: wallpaperImagePath(row.id),
    thumbnail: row.thumbnailKey ? wallpaperThumbnailPath(row.id) : wallpaperImagePath(row.id),
    createdAt: row.createdAt.toISOString(),
  };
}
export async function listWallpapers(ctx: Context) {
  if (ctx.user.role !== 'admin') throw new AppError('forbidden');
  return (await selectWallpapers(ctx.db)).map(shown);
}
// The uploaded file's name is a label only, never part of a path: its folder and extension go,
// control characters go, and it is cut to a length a tile can show.
function nameOf(fileName: string) {
  const base = fileName.split(/[\\/]/u).pop() ?? '';
  const name = base
    .replace(/\.[^.]+$/u, '')
    .replace(/\p{Cc}/gu, '')
    .trim()
    .slice(0, 80);
  return name || 'wallpaper';
}
// A stored binary under a random name, with its own `files` row.
async function store(bytes: Uint8Array, mime: string) {
  const fileId = id();
  const storageKey = `wallpaper-${fileId}`;
  await writeStoredFile(storageKey, bytes);
  return {
    id: fileId,
    storageKey,
    mime,
    sizeBytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
// ADMIN-B47: the upload is checked by size, then by its first bytes, then decoded and re-encoded
// (core/files/wallpaper-image), and only the re-encoded image and its thumbnail are stored. The
// tone and accent come from the decoded pixels, never from the browser. Decoding takes seconds on
// a small server, so it and the file writes happen before the write lock (ADR 0054); the rows go
// in one short transaction, and a failed one removes the files it would have named.
const wallpaperLimit = () =>
  new AppError('rule_violation', { reason: 'limit_reached', max: wallpaperImageLimits.maxStored });
export async function uploadWallpaper(ctx: Context, input: { file: File }) {
  if (ctx.user.role !== 'admin') throw new AppError('forbidden');
  const limit = env().WALLPAPER_MAX_MB * 1024 * 1024;
  if (input.file.size > limit)
    throw new AppError('rule_violation', { reason: 'too_large', maxBytes: limit });
  if ((await countWallpapers(ctx.db)) >= wallpaperImageLimits.maxStored) throw wallpaperLimit();
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  if (!imageTypeOf(bytes)) throw new AppError('rule_violation', { reason: 'unsupported_type' });
  const processed = await processWallpaperImage(bytes);
  const wallpaperId = id();
  const name = nameOf(input.file.name);
  const stored: Awaited<ReturnType<typeof store>>[] = [];
  try {
    stored.push(await store(processed.image, processed.mime));
    stored.push(await store(processed.thumbnail, processed.mime));
    const [image, thumbnail] = stored;
    if (!image || !thumbnail) throw new AppError('internal');
    return await withTransaction(ctx.db, async (database) => {
      // Checked again under the lock: two uploads may both have passed the check above.
      if ((await countWallpapers(database)) >= wallpaperImageLimits.maxStored)
        throw wallpaperLimit();
      await insertWallpaper(database, {
        id: wallpaperId,
        name,
        tone: processed.tone,
        accent: processed.accent,
        createdBy: ctx.user.id,
        image,
        thumbnail,
      });
      const { tone, accent } = processed;
      await writeAudit(database, ctx.user.id, 'create', 'wallpaper', wallpaperId, {
        name,
        tone,
        accent,
      });
      const row = await selectWallpaperById(database, wallpaperId);
      if (!row) throw new AppError('internal');
      return shown(row);
    });
  } catch (error) {
    for (const file of stored) await removeStoredFile(file.storageKey);
    throw error;
  }
}
// Deleting is for good: both rows and the binary go. The chosen wallpaper falls back to the
// default first, so no page is ever drawn on an image that no longer exists. The files go only
// once the rows' removal has committed (ADR 0054): a rollback must never leave a row without them.
export async function deleteWallpaper(ctx: Context, wallpaperId: string) {
  if (ctx.user.role !== 'admin') throw new AppError('forbidden');
  const { row, result } = await withTransaction(ctx.db, async (database) => {
    await lockWorkspace(database);
    const row = await selectWallpaperById(database, wallpaperId);
    if (!row) throw new AppError('not_found');
    const chosen = await getSetting(database, 'workspace.wallpaper');
    const reset = chosen === row.id;
    if (reset) {
      await writeSetting(database, 'workspace.wallpaper', defaultWallpaper, ctx.user.id);
      await writeAudit(database, ctx.user.id, 'update', 'setting', null, {
        key: 'workspace.wallpaper',
        value: defaultWallpaper,
      });
    }
    await deleteWallpaperRows(database, row);
    await writeAudit(database, ctx.user.id, 'delete', 'wallpaper', row.id, { name: row.name });
    const wallpaper = reset ? defaultWallpaper : WallpaperChoice.parse(chosen);
    return { row, result: { id: row.id, wallpaper } };
  });
  await removeStoredFile(row.storageKey);
  if (row.thumbnailKey) await removeStoredFile(row.thumbnailKey);
  return result;
}
// The image behind an uploaded wallpaper, or its thumbnail, for any signed-in member: every page
// is drawn on it. An image stored before thumbnails were made answers its thumbnail with itself.
export async function wallpaperImage(wallpaperId: string, size: 'full' | 'thumbnail' = 'full') {
  const parsed = z.uuid().safeParse(wallpaperId);
  if (!parsed.success) return null;
  const row = await selectWallpaperById(db(), parsed.data);
  if (!row) return null;
  const thumbnail = size === 'thumbnail' && row.thumbnailKey !== null;
  try {
    return {
      mime: (thumbnail ? row.thumbnailMime : row.mime) ?? row.mime,
      bytes: await readStoredFile(
        (thumbnail ? row.thumbnailKey : row.storageKey) ?? row.storageKey,
      ),
    };
  } catch {
    return null;
  }
}
