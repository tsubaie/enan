import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';
// The merger has to know the named type steps in tokens.css (ADR 0030). Without them it reads
// `text-heading` as a colour, and a heading that also names its ink (`text-danger`) loses its size.
const merge = extendTailwindMerge({
  extend: { theme: { text: ['meta', 'nav', 'brand', 'heading', 'title', 'display'] } },
});
export function cn(...values: ClassValue[]) {
  return merge(clsx(values));
}
