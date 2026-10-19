'use client';
import Image from 'next/image';
import { Check } from 'lucide-react';
import { cn } from '@/ui/cn';
// One wallpaper: a swatch of itself, its name under it, and a ring and a tick when it is chosen.
// A built-in swatch is painted by tokens.css; an uploaded one shows its own image.
export function WallpaperSwatch({
  label,
  swatch,
  image,
  chosen,
  busy,
  choose,
}: {
  label: string;
  swatch: string;
  image?: string;
  chosen: boolean;
  busy: boolean;
  choose: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={chosen}
      disabled={busy}
      className="group grid min-w-0 gap-1.5 rounded-xl text-start outline-none"
      onClick={choose}
    >
      <span
        data-swatch={swatch}
        className={cn(
          'wallpaper-swatch relative flex aspect-video items-end justify-end overflow-hidden rounded-xl border p-1.5 transition-shadow',
          !chosen && 'group-hover:border-text-faint',
        )}
      >
        {/* The image is the app's own, behind the session, so it is shown as it is served. */}
        {image && (
          <Image src={image} alt="" fill unoptimized sizes="12rem" className="object-cover" />
        )}
        {/* The choice and the keyboard focus are drawn inside the tile, over its picture, so no
            scrolling container around the picker can clip them at its edge. */}
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 rounded-xl ring-inset group-focus-visible:ring-3 group-focus-visible:ring-ring/60',
            chosen && 'ring-2 ring-primary shadow-[inset_0_0_0_4px_var(--color-bg)]',
          )}
        />
        {chosen && (
          <span className="relative flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="size-3.5" aria-hidden />
          </span>
        )}
      </span>
      <span className="truncate px-0.5 text-xs font-light text-text-muted">{label}</span>
    </button>
  );
}
