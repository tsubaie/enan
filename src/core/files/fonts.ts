import 'server-only';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '@/core/config/env';
// ADMIN-B51 (ADR 0049): an install may supply its own Arabic faces. Files in FONTS_DIR named
// `text-<weight>.woff2` and `display-<weight>.woff2` become the Arabic text and display faces; they
// cover the Arabic block only, so Latin stays in Inter, and any weight they lack falls through to
// Noto Sans Arabic. With no such files nothing changes. The names are the whole contract, so a
// request can only ever reach a font file in that one directory.
const NAME = /^(text|display)-([1-9]00)\.woff2$/u;
const ARABIC = 'U+0600-06FF, U+0750-077F, U+0870-08FF, U+FB50-FDFF, U+FE70-FEFF, U+200C-200F';
export const fontsPath = '/api/v1/fonts';
export type CustomFace = { role: 'text' | 'display'; weight: number; file: string };
export function fontFaces(names: string[]): CustomFace[] {
  return names
    .flatMap((file) => {
      const match = NAME.exec(file);
      const role: CustomFace['role'] = match?.[1] === 'display' ? 'display' : 'text';
      return match ? [{ role, weight: Number(match[2]), file }] : [];
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}
// The faces, and the two custom properties tokens.css reads in front of Noto: each ends in a comma
// so it slots into the font stacks, and a display face falls back to the text one.
export function fontCss(faces: CustomFace[]) {
  const family = (role: CustomFace['role']) =>
    role === 'display' ? 'Enan Arabic Display' : 'Enan Arabic';
  const rules = faces.map(
    (face) =>
      `@font-face{font-family:'${family(face.role)}';src:url('${fontsPath}/${face.file}') format('woff2');font-weight:${face.weight};font-display:swap;unicode-range:${ARABIC};}`,
  );
  const text = faces.some((face) => face.role === 'text') ? `'Enan Arabic',` : '';
  const display = faces.some((face) => face.role === 'display') ? `'Enan Arabic Display',` : '';
  return `${rules.join('\n')}\n:root{--font-arabic-custom:${text};--font-arabic-display-custom:${display}${text};}\n`;
}
export async function customFonts(dir = env().FONTS_DIR) {
  return fontFaces(await readdir(dir).catch(() => []));
}
// GET /api/v1/fonts/<file>: the stylesheet (`faces.css`) or one face. Public, because the sign-in
// page is set in the same type; it serves nothing but the files the names above admit.
export async function fontFile(_request: Request, route: { params: Promise<{ file: string }> }) {
  const { file } = await route.params;
  if (file === 'faces.css')
    return new Response(fontCss(await customFonts()), {
      headers: {
        'Content-Type': 'text/css; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    });
  const bytes = NAME.test(file)
    ? await readFile(join(env().FONTS_DIR, file)).catch(() => null)
    : null;
  if (!bytes) return Response.json({ error: { code: 'not_found' } }, { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'font/woff2',
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
