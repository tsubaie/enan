import 'server-only';
import type { WallpaperMime } from '@/core/config/wallpapers';
// ADMIN-B47: an image's type is read from its first bytes, never from its name or the type the
// browser declared, so a renamed file cannot pass for a picture. JPEG starts FF D8 FF; PNG with its
// eight-byte signature; WebP is a RIFF container whose form type at byte 8 is "WEBP".
const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((byte, index) => bytes[offset + index] === byte);
export function imageTypeOf(bytes: Uint8Array): WallpaperMime | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return 'image/webp';
  return null;
}
