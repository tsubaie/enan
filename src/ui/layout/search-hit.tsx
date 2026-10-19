'use client';
import { usePlainDate } from '@/ui/format';
// A result's secondary line. A bare calendar day is written the way every date in the app is, not as
// an ISO string;
// anything else is shown as the module wrote it. Its direction is isolated so a date never jumps to
// the far side of an Arabic row.
export function HitSubtitle({ text }: { text: string }) {
  const date = usePlainDate();
  return <bdi>{/^\d{4}-\d{2}-\d{2}$/u.test(text) ? date(text) : text}</bdi>;
}
// After Spotlight: the words of a title that match what was typed are set in the full ink and
// semibold, the rest in the secondary ink, so the eye finds why each result is there. The emphasis
// covers whole words: a weight change inside an Arabic word would break its letters' joining.
export function Matched({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  const start = text.slice(0, at).search(/\S*$/u);
  const rest = text.slice(at + query.length).search(/\s|$/u);
  const end = at + query.length + rest;
  return (
    <span className="text-text-muted">
      {text.slice(0, start)}
      <span className="font-semibold text-text">{text.slice(start, end)}</span>
      {text.slice(end)}
    </span>
  );
}
