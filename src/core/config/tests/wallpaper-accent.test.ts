import { describe, expect, it } from 'vitest';
import {
  accentGrounds,
  accentTokens,
  averageLuma,
  clearHue,
  contrast,
  hexToRgb,
  minimumContrast,
  pickAccent,
  rgbToHex,
  rgbToOklch,
  sageAccent,
} from '../wallpaper-accent';
import { toneOf } from '../wallpapers';
// ADMIN-B47 (ADR 0037): the accent picked from a wallpaper's pixels and made readable per theme.
type Rgb = [number, number, number];
// An RGBA image of `size` pixels, filled by share: [[colour, fraction], ...].
function image(parts: [Rgb, number][], size = 4096) {
  const pixels: number[] = [];
  for (const [colour, share] of parts)
    for (let i = 0; i < Math.round(share * size); i += 1) pixels.push(...colour, 255);
  return new Uint8ClampedArray(pixels);
}
const hueOf = (hex: string) => rgbToOklch(hexToRgb(hex)).h;
const readableEverywhere = (tokens: ReturnType<typeof accentTokens>) => {
  for (const ground of accentGrounds.night)
    expect(contrast(tokens.night.accent, ground)).toBeGreaterThanOrEqual(minimumContrast);
  for (const ground of accentGrounds.paper)
    expect(contrast(tokens.paper.accent, ground)).toBeGreaterThanOrEqual(minimumContrast);
  expect(contrast(tokens.night.onAccent, tokens.night.accent)).toBeGreaterThanOrEqual(
    minimumContrast,
  );
  expect(contrast(tokens.paper.onAccent, tokens.paper.accent)).toBeGreaterThanOrEqual(
    minimumContrast,
  );
};
const navy: Rgb = [10, 12, 30];
const blue: Rgb = [40, 90, 230];
const teal: Rgb = [20, 150, 150];
const red: Rgb = [220, 30, 30];
const grey: Rgb = [128, 128, 128];

describe('ADMIN-B47 the accent follows the wallpaper', () => {
  it('ADMIN-B47 a vivid image gives its own hue, not the grey average of all its pixels', () => {
    // Mostly a dark ground with a vivid band of blue and a little teal: blue wins on chroma × share.
    const picked = pickAccent(
      image([
        [navy, 0.7],
        [blue, 0.2],
        [teal, 0.1],
      ]),
    );
    expect(picked).not.toBeNull();
    expect(Math.abs(hueOf(picked ?? '') - rgbToOklch(blue).h)).toBeLessThan(8);
    const tokens = accentTokens(picked);
    expect(Math.abs(hueOf(tokens.night.accent) - rgbToOklch(blue).h)).toBeLessThan(12);
    readableEverywhere(tokens);
  });
  it('ADMIN-B47 a grey image, or a colour on too small a share of it, gives the sage fallback', () => {
    expect(pickAccent(image([[grey, 1]]))).toBeNull();
    expect(
      pickAccent(
        image([
          [grey, 0.99],
          [blue, 0.01],
        ]),
      ),
    ).toBeNull();
    expect(accentTokens(null)).toEqual(sageAccent);
  });
  it('ADMIN-B47 a red or amber image never gives a danger-like accent', () => {
    const picked = pickAccent(
      image([
        [red, 0.6],
        [navy, 0.4],
      ]),
    );
    expect(accentTokens(picked)).toEqual(sageAccent);
    expect(accentTokens(rgbToHex([230, 140, 20]))).toEqual(sageAccent);
    // A hue just inside the reserved arc is moved to its edge rather than dropped.
    expect(clearHue(108)).toBe(108);
    expect(clearHue(95)).toBe(101);
    expect(clearHue(5)).toBe(358);
    expect(clearHue(50)).toBeNull();
  });
  it('ADMIN-B47 every derived accent reads at 4.5:1 or better in both themes, around the hue circle', () => {
    for (let hue = 0; hue < 360; hue += 15) {
      const radians = (hue * Math.PI) / 180;
      const colour: Rgb = [
        Math.round(128 + 100 * Math.cos(radians)),
        Math.round(128 + 100 * Math.cos(radians - 2.1)),
        Math.round(128 + 100 * Math.cos(radians + 2.1)),
      ];
      readableEverywhere(accentTokens(rgbToHex(colour)));
    }
    readableEverywhere(sageAccent);
  });
  it('ADMIN-B47 the tone is light only for a bright image', () => {
    expect(toneOf(averageLuma(image([[[240, 240, 245], 1]])))).toBe('light');
    expect(
      toneOf(
        averageLuma(
          image([
            [navy, 0.8],
            [blue, 0.2],
          ]),
        ),
      ),
    ).toBe('dark');
  });
});
