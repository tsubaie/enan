import { cn } from '@/ui/cn';
import { initials } from '@/ui/format';
// Compact initials avatar for owners in list rows; the full name stays available to assistive
// technology and on hover. `decorative` is for an avatar whose name is already written beside it,
// where saying it twice would only repeat the name to a screen reader.
export function Avatar({
  name,
  className,
  decorative = false,
}: {
  name: string;
  className?: string;
  decorative?: boolean;
}) {
  if (decorative)
    return (
      <span
        aria-hidden
        className={cn(
          'inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-raised text-[10px] font-semibold text-text',
          className,
        )}
      >
        <bdi>{initials(name)}</bdi>
      </span>
    );
  return (
    <span
      title={name}
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-raised text-[10px] font-semibold text-text',
        className,
      )}
    >
      <bdi aria-hidden>{initials(name)}</bdi>
      <span className="sr-only">{name}</span>
    </span>
  );
}
