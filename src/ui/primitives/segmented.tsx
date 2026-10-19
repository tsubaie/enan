'use client';
import { cn } from '@/ui/cn';
import { Button } from './button';
// The capsule segmented control (docs/design-system.md § Controls): a capsule track with the chosen
// segment lifted out of it in Medium, the others Light. It picks one of a few mutually exclusive
// values that are worth seeing side by side (a person's type, a review's view), where a menu would
// hide the alternative. Each segment is a toggle button with `aria-pressed`, so assistive technology
// hears which one is on; `label` names the group.
//
// In the night theme the day's recipe (a grey track, the chosen segment on the surface) fails: the
// surface is a dark frost, no lighter than the track over a bright band of the wallpaper, so the
// choice could not be seen. There the control is flat, like the language toggle in the header: a
// plain track and the chosen segment a flat white wash with full-ink text, the others muted. No
// shadow, rim or inner highlight: nothing in the night theme is drawn as if raised. Tabs mark the
// chosen segment with `data-active` instead of `aria-pressed`; `segmentedItem` carries the same
// wash for that state so a tab strip built on these classes matches.
export const segmentedTrack =
  'inline-flex rounded-full bg-surface-raised p-0.5 dark:border dark:bg-surface/40';
export const segmentedItem =
  'h-8 rounded-full px-3.5 text-sm font-light text-text-muted pointer-coarse:h-10 dark:hover:bg-white/8 dark:data-active:bg-white/15 dark:data-active:text-text dark:data-active:shadow-none dark:data-active:hover:bg-white/15';
export const segmentedItemOn =
  'bg-surface font-medium text-text shadow-sm hover:bg-surface dark:bg-white/15 dark:text-text dark:shadow-none dark:hover:bg-white/15';
export type Segment<T extends string> = { value: T; label: string; className?: string };
export function Segmented<T extends string>({
  label,
  value,
  segments,
  onChange,
  className,
}: {
  label: string;
  value: T;
  segments: Segment<T>[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn(segmentedTrack, 'w-fit', className)}>
      {segments.map((segment) => (
        <Button
          key={segment.value}
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={value === segment.value}
          className={cn(
            segmentedItem,
            'min-h-0',
            value === segment.value && segmentedItemOn,
            segment.className,
          )}
          onClick={() => {
            if (value !== segment.value) onChange(segment.value);
          }}
        >
          {segment.label}
        </Button>
      ))}
    </div>
  );
}
