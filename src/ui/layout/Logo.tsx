// The mark: a Sadu motif, the diamond the Bedouin loom repeats along its bands, held between two
// woven chevrons. It is the weave reduced to one unit, so the silhouette holds at small sizes.
// The chevrons can take an accent through pointClassName; the mark never mirrors in RTL.
export function Logo({
  className,
  pointClassName,
  title,
}: {
  className?: string;
  pointClassName?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <path fillRule="evenodd" d="M12 3 18 12 12 21 6 12ZM12 8 9.3 12 12 16 14.7 12Z" />
      <path
        d="M5 5 1 12 5 19 6.5 16.2 4.1 12 6.5 7.8ZM19 5 17.5 7.8 19.9 12 17.5 16.2 19 19 23 12Z"
        fill="currentColor"
        className={pointClassName}
      />
    </svg>
  );
}
