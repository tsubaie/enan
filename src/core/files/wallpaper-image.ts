import 'server-only';
import sharp from 'sharp';
import { averageLuma, pickAccent } from '@/core/config/wallpaper-accent';
import { toneOf, wallpaperImageLimits } from '@/core/config/wallpapers';
import { AppError } from '@/core/http/errors';
// ADMIN-B47 (ADR 0037): an uploaded wallpaper is decoded and re-encoded in process with sharp
// (libvips linked into the module, not a subprocess, so ADR 0029 holds). Only the pixels survive:
// the stored image is a fresh WebP with no metadata (EXIF, GPS, comments, foreign ICC profiles), so
// a polyglot or a payload hidden in the upload is never stored or served. The tone and the accent
// are measured here, from the decoded pixels, with the same functions the built-ins use.
const refuse = (reason: string, details: Record<string, number> = {}) =>
  new AppError('rule_violation', { reason, ...details });
const decode = (bytes: Uint8Array) =>
  sharp(bytes, { limitInputPixels: wallpaperImageLimits.maxPixels, failOn: 'error' });

async function inspect(bytes: Uint8Array) {
  const meta = await sharp(bytes, { limitInputPixels: false, failOn: 'error' })
    .metadata()
    .catch(() => null);
  if (!meta) throw refuse('unreadable');
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  // A header that claims more pixels than the limit is refused before anything is decoded.
  if (width * height > wallpaperImageLimits.maxPixels) throw refuse('too_many_pixels');
  if ((meta.pages ?? 1) > 1) throw refuse('animated');
  if (Math.max(width, height) < wallpaperImageLimits.minLongEdge)
    throw refuse('too_small', { minLongEdge: wallpaperImageLimits.minLongEdge });
}
export async function processWallpaperImage(bytes: Uint8Array) {
  await inspect(bytes);
  let image: Buffer;
  try {
    image = await decode(bytes)
      .rotate()
      .resize({
        width: wallpaperImageLimits.maxWidth,
        height: wallpaperImageLimits.maxHeight,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 80, smartSubsample: true })
      .toBuffer();
  } catch {
    throw refuse('unreadable');
  }
  const thumbnail = await sharp(image)
    .resize({ width: wallpaperImageLimits.thumbnailWidth, withoutEnlargement: true })
    .webp({ quality: 75 })
    .toBuffer();
  const pixels = await sharp(image).resize(64, 64, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
  return {
    image,
    thumbnail,
    mime: 'image/webp',
    tone: toneOf(averageLuma(pixels)),
    accent: pickAccent(pixels),
  };
}
