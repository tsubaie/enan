'use client';
import { useState, type ComponentProps, type FocusEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Textarea } from '@/ui/primitives/textarea';
import { cn } from '@/ui/cn';
import { recordTitle } from './Record';
// The record's name is its heading and the place it is edited, both at once (docs/design-system.md
// § Records): a task, a note, a committee and a person never show the name read-only above a second
// copy of it in a field. It reads as the 22 px Semibold title, shows a hairline only under the
// pointer, wraps instead of scrolling, and Enter commits rather than breaking the line. `label` is
// the accessible name ("Task title", "Full name").
type TitleInputProps = Omit<ComponentProps<'textarea'>, 'rows'> & {
  label: string;
  error?: string | undefined;
};
export function RecordTitleInput({
  label,
  error,
  className,
  onKeyDown,
  ...props
}: TitleInputProps) {
  return (
    <div className="grid gap-1">
      <h2 tabIndex={-1} className="min-w-0 rounded-md">
        <Textarea
          required
          rows={1}
          maxLength={500}
          aria-label={label}
          aria-invalid={Boolean(error)}
          className={cn(
            'plaintext min-h-0 resize-none rounded-md border-transparent bg-transparent px-2 py-1 hover:border-border dark:bg-transparent md:text-title',
            recordTitle,
            className,
          )}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            }
            onKeyDown?.(event);
          }}
          {...props}
        />
      </h2>
      {error && (
        <span role="alert" className="px-2 text-xs text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
// The same title for a record that saves each field on its own: it keeps a draft re-based on the
// saved name whenever that changes, commits a trimmed, changed, non-empty name on leave, and says
// a name is required while the field is empty.
export function RecordTitleField({
  value,
  label,
  save,
  kind = 'title',
  className,
}: {
  value: string;
  label: string;
  save: (value: string) => void;
  // A person or a committee has a name rather than a title, and its empty-field message says so.
  kind?: 'title' | 'name';
  className?: string;
}) {
  const c = useTranslations('common');
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  const blur = (event: FocusEvent<HTMLTextAreaElement>) => {
    const next = event.target.value.trim();
    if (next && next !== value) save(next);
  };
  return (
    <RecordTitleInput
      label={label}
      value={draft}
      className={className}
      error={draft.trim() ? undefined : c(kind === 'name' ? 'nameRequired' : 'titleRequired')}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={blur}
    />
  );
}
