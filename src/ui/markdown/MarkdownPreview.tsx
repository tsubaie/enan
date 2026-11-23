'use client';
import { Suspense, lazy, useRef, type MouseEvent } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/ui/cn';
const Markdown = lazy(() => import('./Markdown').then((m) => ({ default: m.Markdown })));
// What the preview needs of the field's draft (MarkdownField's useDraft).
type PreviewField = {
  draft: string;
  toggle: (index: number) => void;
  enter: (caret: number | null) => void;
  pending: boolean;
  blur: () => void;
};
// While the editor half loads on first entry the preview stays, busy with a wait cursor, and
// assistive tech hears that it is on its way (a status is a polite live region). It exists only
// while loading, so it never stands beside the page's own save status.
export function LoadingStatus({ pending }: { pending: boolean }) {
  const t = useTranslations('common');
  if (!pending) return null;
  return (
    <span role="status" className="sr-only">
      {t('loading')}
    </span>
  );
}
// The rendered content over a button that opens the textarea. The content lets pointer events
// through to the button beneath it, except its checklist boxes, which toggle in place; the two
// are siblings because a control cannot contain another control, and links render as text.
export function Preview({
  id,
  label,
  name,
  field,
}: {
  id: string;
  label: string;
  name?: string | undefined;
  field: PreviewField;
}) {
  const { draft, toggle, enter: edit, pending, blur } = field;
  const t = useTranslations('common');
  const box = useRef<HTMLDivElement>(null);
  // A pointer click lands the caret where it hit; keyboard activation lands it at the end.
  const click = (event: MouseEvent<HTMLButtonElement>) => {
    const root = event.detail > 0 ? box.current : null;
    if (!root) return edit(null);
    const { clientX, clientY } = event;
    // Loaded on demand: the mapping is only needed for pointer clicks and stays out of routes.
    void import('./caret').then(({ sourceOffsetFromPoint }) => {
      // Hit testing for the caret needs the content solid for a moment.
      root.classList.remove('pointer-events-none');
      const at = sourceOffsetFromPoint(root, clientX, clientY, draft);
      root.classList.add('pointer-events-none');
      edit(at);
    });
  };
  return (
    <div className={cn('relative grid', draft.trim() ? 'min-h-40' : 'min-h-20')}>
      {name && <input type="hidden" name={name} value={draft} />}
      <button
        type="button"
        id={id}
        aria-label={label}
        aria-busy={pending || undefined}
        title={t('clickToWrite')}
        data-field-frame=""
        className={cn(
          'absolute inset-0 rounded-lg border hover:border-ring focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
          pending ? 'cursor-wait' : 'cursor-text',
        )}
        onClick={click}
        onBlur={blur}
      />
      <div ref={box} className="pointer-events-none relative px-3 py-2 font-light">
        <Suspense fallback={<div className="h-20" />}>
          <Markdown content={draft} interactive={false} onToggle={toggle} />
        </Suspense>
      </div>
    </div>
  );
}
