import { expect, it } from 'vitest';
import { fontCss, fontFaces } from '../fonts';
// ADMIN-B51: an install's own Arabic faces come from file names alone, and only those names.
it('ADMIN-B51 only text-<weight> and display-<weight> woff2 files become faces', () => {
  const faces = fontFaces([
    'text-400.woff2',
    'display-700.woff2',
    'text-450.woff2',
    'text-400.ttf',
    '../text-400.woff2',
    'notes.txt',
  ]);
  expect(faces).toEqual([
    { role: 'display', weight: 700, file: 'display-700.woff2' },
    { role: 'text', weight: 400, file: 'text-400.woff2' },
  ]);
});
it('ADMIN-B51 the stylesheet covers Arabic only and puts the faces in front of Noto', () => {
  const css = fontCss(fontFaces(['text-400.woff2', 'display-700.woff2']));
  expect(css).toContain("font-family:'Enan Arabic';src:url('/api/v1/fonts/text-400.woff2')");
  expect(css).toContain('unicode-range:U+0600-06FF');
  // Display falls back to the text face, and each property ends in a comma for the stacks.
  expect(css).toContain("--font-arabic-display-custom:'Enan Arabic Display','Enan Arabic',");
  // No faces: both properties are empty, so the stacks reach Noto directly.
  expect(fontCss([])).toContain('--font-arabic-custom:;--font-arabic-display-custom:;');
});
