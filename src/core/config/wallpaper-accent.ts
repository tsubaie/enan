// ADMIN-B47 (ADR 0037): the accent follows the wallpaper. One pure module, used by the server on
// an uploaded image's decoded pixels and by scripts/build/wallpaper-accents.ts for the built-in
// wallpapers, so both pick and derive the same colours.
//
// Picking: the image's pixels go to OKLCH and are bucketed by hue; a bucket scores the chroma of
// every pixel in it, so a colour wins by being both vivid and widespread, and greys score nothing.
// The winner must cover a meaningful share of the image, or there is no accent to take.
//
// Deriving: the picked hue is made readable for each theme. Its lightness is pushed until the
// accent reaches 4.5:1 on the lightest surface accent text sits on (the inset sheet at night,
// the page ground on paper); its chroma is kept within what reads as an accent and sRGB can show.
// A hue close to the danger red or the warning amber is moved away from them, or replaced by the
// sage fallback, so the accent never reads as "overdue" or "high priority".

type Rgb = [number, number, number];
export type Oklch = { l: number; c: number; h: number };
export type AccentSet = { accent: string; soft: string; onAccent: string };
export type AccentTokens = { night: AccentSet; paper: AccentSet };

// Colours are written as sRGB channel triples here and leave as hex strings (`#rrggbb`, and
// `#rrggbbaa` for the translucent soft wash at night), the form tokens.css and the page take.
export function rgbToHex(rgb: Rgb, alpha?: number) {
  const channels = alpha === undefined ? rgb : [...rgb, Math.round(alpha * 255)];
  return `#${channels.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
const white: Rgb = [255, 255, 255];
const softAlpha = 0.24;
// ADR 0036: the sage accent, kept as the fallback when a wallpaper has no usable colour.
export const sageAccent: AccentTokens = {
  night: {
    accent: rgbToHex([154, 216, 180]),
    soft: rgbToHex([84, 170, 124], softAlpha),
    onAccent: rgbToHex([11, 36, 24]),
  },
  paper: {
    accent: rgbToHex([46, 107, 84]),
    soft: rgbToHex([225, 238, 230]),
    onAccent: rgbToHex(white),
  },
};
// The surfaces accent text must read on (tokens.css): the night inset sheet (`--sheet-top`,
// opaque enough to count as solid) and the night canvas, and the paper ground (`--bg`) and surface.
export const accentGrounds = {
  night: [rgbToHex([49, 49, 58]), rgbToHex([36, 36, 40])],
  paper: [rgbToHex([236, 238, 241]), rgbToHex([253, 253, 254])],
};
export const minimumContrast = 4.5;
// The hues of the danger and warning inks (night #ffa8a1 and #ffc670, paper #b03a3a and #8a5e0b,
// measured in OKLCH) and how far from them the accent must stay.
const reservedHues = [24, 75];
const reservedSpan = 25;
const nudgeLimit = 12;
const hueBins = 24;
const greyChroma = 0.02;
const minimumCoverage = 0.03;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const toLinear = (channel: number) => {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) =>
  255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

export function rgbToOklch([r, g, b]: Rgb): Oklch {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return {
    l: L,
    c: Math.hypot(a, bb),
    h: (Math.atan2(bb, a) * 180) / Math.PI + 360 * Number(bb < 0),
  };
}
// OKLCH to sRGB channels (0 to 255, unclamped), so a caller can tell when a colour is out of gamut.
function oklchToRgbRaw({ l, c, h }: Oklch): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    fromLinear(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    fromLinear(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    fromLinear(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  ];
}
const inGamut = (rgb: Rgb) => rgb.every((v) => v >= -0.5 && v <= 255.5);
// The colour as sRGB, with chroma given up (never lightness or hue) until it fits.
function toGamut(colour: Oklch): Rgb {
  let c = colour.c;
  let rgb = oklchToRgbRaw({ ...colour, c });
  while (!inGamut(rgb) && c > 0) {
    c = Math.max(0, c - 0.002);
    rgb = oklchToRgbRaw({ ...colour, c });
  }
  const channel = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
  return [channel(rgb[0]), channel(rgb[1]), channel(rgb[2])];
}
export function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// WCAG 2 relative luminance and contrast ratio.
function luminance(rgb: Rgb) {
  return 0.2126 * toLinear(rgb[0]) + 0.7152 * toLinear(rgb[1]) + 0.0722 * toLinear(rgb[2]);
}
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(hexToRgb(a)), luminance(hexToRgb(b))].sort((p, q) => q - p);
  return ((x ?? 0) + 0.05) / ((y ?? 0) + 0.05);
}

// The image's own most vivid widespread colour, as #rrggbb, or null when it has none (a grey or
// near-monochrome image). `pixels` is RGBA, four bytes a pixel, as a canvas returns them.
export function pickAccent(pixels: ArrayLike<number>): string | null {
  const bins = Array.from({ length: hueBins }, () => ({ score: 0, count: 0, a: 0, b: 0, l: 0 }));
  let total = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if ((pixels[i + 3] ?? 0) < 128) continue;
    total += 1;
    const colour = rgbToOklch([pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0]);
    if (colour.c < greyChroma) continue;
    const bin = bins[Math.floor(colour.h / (360 / hueBins)) % hueBins];
    if (!bin) continue;
    const radians = (colour.h * Math.PI) / 180;
    bin.score += colour.c;
    bin.count += 1;
    bin.a += colour.c * Math.cos(radians) * colour.c;
    bin.b += colour.c * Math.sin(radians) * colour.c;
    bin.l += colour.l * colour.c;
  }
  const best = bins
    .filter((bin) => total > 0 && bin.count / total >= minimumCoverage)
    .sort((x, y) => y.score - x.score)[0];
  if (!best) return null;
  const a = best.a / best.score;
  const b = best.b / best.score;
  const picked = {
    l: best.l / best.score,
    c: Math.hypot(a, b),
    h: ((((Math.atan2(b, a) * 180) / Math.PI) % 360) + 360) % 360,
  };
  if (picked.c < greyChroma) return null;
  // A dark image's colour is kept at a middle lightness, so its hue survives eight-bit channels;
  // the accent sets its own lightness from it anyway.
  return rgbToHex(toGamut({ ...picked, l: clamp(picked.l, 0.45, 0.8) }));
}

// The danger and warning hues sit close together, so the hues within the span of either form one
// reserved arc, from below danger to beyond warning. A hue inside it is moved to the arc's nearer
// edge when it is only a little inside, or is null when it sits squarely among them.
const reservedFrom = Math.min(...reservedHues) - reservedSpan;
const reservedTo = Math.max(...reservedHues) + reservedSpan;
export function clearHue(hue: number): number | null {
  const offset = (((hue - reservedFrom) % 360) + 360) % 360;
  const width = reservedTo - reservedFrom;
  if (offset >= width) return hue;
  const toStart = offset;
  const toEnd = width - offset;
  if (Math.min(toStart, toEnd) > nudgeLimit) return null;
  return toStart <= toEnd ? (reservedFrom - 1 + 360) % 360 : (reservedTo + 1) % 360;
}
// Lightness walked one step at a time towards readability on every ground of the theme.
function readable(hue: number, chroma: number, start: number, step: number, grounds: string[]) {
  let l = start;
  let hex = rgbToHex(toGamut({ l, c: chroma, h: hue }));
  while (grounds.some((g) => contrast(hex, g) < minimumContrast) && l > 0.05 && l < 0.99) {
    l += step;
    hex = rgbToHex(toGamut({ l, c: chroma, h: hue }));
  }
  return hex;
}
// The three accent tokens for each theme from a picked colour; null or a reserved hue gives sage.
export function accentTokens(picked: string | null): AccentTokens {
  if (!picked) return sageAccent;
  const colour = rgbToOklch(hexToRgb(picked));
  const hue = colour.c < greyChroma ? null : clearHue(colour.h);
  if (hue === null) return sageAccent;
  const chroma = clamp(colour.c, 0.06, 0.13);
  const nightAccent = readable(hue, chroma, clamp(colour.l, 0.8, 0.86), 0.01, accentGrounds.night);
  const paperAccent = readable(hue, chroma, clamp(colour.l, 0.42, 0.5), -0.01, accentGrounds.paper);
  return {
    night: {
      accent: nightAccent,
      soft: rgbToHex(toGamut({ l: 0.68, c: Math.min(chroma, 0.12), h: hue }), softAlpha),
      onAccent: rgbToHex(toGamut({ l: 0.22, c: Math.min(chroma * 0.5, 0.05), h: hue })),
    },
    paper: {
      accent: paperAccent,
      soft: rgbToHex(toGamut({ l: 0.94, c: Math.min(chroma * 0.3, 0.035), h: hue })),
      onAccent: rgbToHex(white),
    },
  };
}
// The accent's custom properties, as the page carries them for an uploaded wallpaper and as
// tokens.css declares them for each built-in one; tokens.css applies them per theme.
export function accentProperties(tokens: AccentTokens): Record<string, string> {
  return {
    '--wallpaper-accent-night': tokens.night.accent,
    '--wallpaper-accent-soft-night': tokens.night.soft,
    '--wallpaper-on-accent-night': tokens.night.onAccent,
    '--wallpaper-accent-paper': tokens.paper.accent,
    '--wallpaper-accent-soft-paper': tokens.paper.soft,
    '--wallpaper-on-accent-paper': tokens.paper.onAccent,
  };
}
// The image's average gamma-encoded luma (0 to 1), which decides its tone (wallpapers.ts, toneOf).
export function averageLuma(pixels: ArrayLike<number>) {
  let sum = 0;
  let count = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if ((pixels[i + 3] ?? 0) < 128) continue;
    sum +=
      (0.2126 * (pixels[i] ?? 0) + 0.7152 * (pixels[i + 1] ?? 0) + 0.0722 * (pixels[i + 2] ?? 0)) /
      255;
    count += 1;
  }
  return count ? sum / count : 0;
}
