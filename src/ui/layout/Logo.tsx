// The mark: the letter ع whose upper curve becomes an Arabian horse's neck and head, for عِنان, the
// rein. One solid shape, so the silhouette holds at small sizes. The mark never mirrors in RTL.
export function Logo({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 256 256"
      fill="currentColor"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <path d="M187.65 240V206H101.65C89.65 206 81.65 198 81.65 188C81.65 172 101.65 164 119.65 161L143.65 157Q153.65 155 152.65 147Q151.65 139 141.65 139C119.65 137 101.65 130 101.65 114C101.65 98 119.65 86 139.65 80C137.65 93 147.65 99 159.65 100L177.65 103Q191.65 115 204.65 109Q214.65 103 209.65 92Q189.65 74 167.65 52Q166.65 32 160.65 16Q149.65 31 136.65 47C101.65 52 73.65 72 66.65 98C61.65 118 65.65 132 77.65 143C57.65 154 44.65 174 44.65 194C44.65 222 69.65 240 103.65 240Z" />
    </svg>
  );
}
