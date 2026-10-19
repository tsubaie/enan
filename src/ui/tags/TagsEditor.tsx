'use client';
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Tag as TagIcon, X } from 'lucide-react';
import { z } from 'zod';
import { cn } from '@/ui/cn';
import { Input } from '@/ui/primitives/input';
import { Property } from '@/ui/layout/Property';
export const TAG_LIMIT = 10;
const Tag = z.string().trim().min(1).max(50);
// Case-insensitive, first spelling kept: the rule every module's tag schema applies on save.
const dedupe = (values: string[]) =>
  values.filter(
    (value, index) =>
      values.findIndex((other) => other.toLowerCase() === value.toLowerCase()) === index,
  );
// The tags already in use where this record lives, most used first, and a way to fetch them again
// when the field gains focus. Each module supplies its own (a note's from notes, a person's from
// people), so the editor itself reads no module's data.
export type TagSuggestions = { tags: { tag: string; count: number }[]; refresh: () => void };
// The one tag field every record uses (docs/design-system.md § Tags): chips with the remove button
// inside them, then one input. Typing filters the suggestions in a list under the input; a tag
// picked from the list is added at once, and a name that matches none is added with Enter, comma,
// or the list's own "Add" row. Overflow beyond ten is blocked with a count. `action` sits at the
// end of the row, beside the field it acts on. The editor is a row of the record's property sheet.
type TagsEditorProps = {
  tags: string[];
  save: (tags: string[]) => void;
  suggestions: TagSuggestions;
  label?: string;
  action?: ReactNode;
  // A create form stacks its label above the field, as its other fields do; a record passes nothing.
  stacked?: boolean;
};
export function TagsEditor({ label, stacked = false, ...props }: TagsEditorProps) {
  const t = useTranslations('common');
  const name = label ?? t('tags');
  if (stacked)
    return (
      <div className="grid gap-2">
        <span className="text-sm font-medium">{name}</span>
        <TagsField {...props} />
      </div>
    );
  return (
    <Property label={name} quiet empty={!props.tags.length}>
      <TagsField {...props} />
    </Property>
  );
}
function TagsField({
  tags,
  save,
  suggestions,
  action,
}: Omit<TagsEditorProps, 'label' | 'stacked'>) {
  const t = useTranslations('common');
  const picker = useTagPicker(tags, save, suggestions);
  return (
    <div className="flex flex-wrap items-center gap-1.5 py-1">
      <TagChips tags={tags} remove={(tag) => save(tags.filter((item) => item !== tag))} />
      <div className="relative">
        <Input
          autoComplete="off"
          value={picker.draft}
          aria-label={t('addTagLabel')}
          placeholder={t('addTagPlaceholder')}
          maxLength={50}
          role="combobox"
          aria-expanded={picker.open}
          aria-controls={picker.open ? picker.listId : undefined}
          aria-activedescendant={picker.open ? picker.activeId : undefined}
          className="h-8 w-40 text-sm"
          onChange={(event) => picker.type(event.target.value)}
          onFocus={picker.focus}
          onKeyDown={picker.keyDown}
          onBlur={picker.blur}
        />
        {picker.open && <TagMenu picker={picker} />}
      </div>
      {action && <span className="ms-auto shrink-0">{action}</span>}
      {(picker.blocked || picker.full) && (
        <span
          role={picker.blocked ? 'alert' : undefined}
          className="w-full text-xs text-text-muted"
        >
          {t('tagOverflow', { count: tags.length, limit: TAG_LIMIT })}
        </span>
      )}
    </div>
  );
}
type Row = { tag: string; count: number; create?: boolean };
type Picker = ReturnType<typeof useTagPicker>;
function useTagPicker(tags: string[], save: (tags: string[]) => void, suggestions: TagSuggestions) {
  const listId = useId();
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const full = tags.length >= TAG_LIMIT;
  const items = rowsFor(suggestions.tags, tags, draft);
  const add = (raw: string) => {
    const parsed = Tag.safeParse(raw);
    if (!parsed.success) return;
    if (full) return setBlocked(true);
    const next = dedupe([...tags, parsed.data]);
    setDraft('');
    setActive(0);
    setBlocked(false);
    if (next.length !== tags.length) save(next);
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      if (items.length) setActive((index) => (index + step + items.length) % items.length);
    } else if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add(open && items[active] ? items[active].tag : event.currentTarget.value);
    } else if (event.key === 'Escape' && open) {
      event.stopPropagation();
      setOpen(false);
    }
  };
  return {
    listId,
    draft,
    open: open && items.length > 0,
    items,
    active,
    activeId: items[active] ? `${listId}-${active}` : undefined,
    blocked,
    full,
    type: (value: string) => {
      setDraft(value);
      setActive(0);
      setOpen(true);
    },
    focus: () => {
      suggestions.refresh();
      setOpen(true);
    },
    blur: (event: { target: HTMLInputElement }) => {
      setOpen(false);
      if (event.target.value.trim()) add(event.target.value);
    },
    pick: (row: Row) => add(row.tag),
    keyDown,
  };
}
// Existing tags still in use, not already on the record, matching what is typed; and, when the
// typed name matches none exactly, an "Add" row for it.
function rowsFor(all: { tag: string; count: number }[], tags: string[], draft: string): Row[] {
  const needle = draft.trim().toLowerCase();
  const rows: Row[] = all
    .filter((row) => row.count > 0)
    .filter((row) => !tags.some((tag) => tag.toLowerCase() === row.tag.toLowerCase()))
    .filter((row) => !needle || row.tag.toLowerCase().includes(needle))
    .slice(0, 8);
  const typed = draft.trim();
  if (typed && !rows.some((row) => row.tag.toLowerCase() === needle))
    rows.push({ tag: typed, count: 0, create: true });
  return rows;
}
// The list under the input: the tag names alone, since how often each is used says nothing about
// whether it belongs on this record. Rows pick on mouse down so the input never loses focus.
function TagMenu({ picker }: { picker: Picker }) {
  const t = useTranslations('common');
  return (
    <ul
      id={picker.listId}
      role="listbox"
      aria-label={t('tags')}
      className="absolute start-0 z-20 mt-1 max-h-56 w-64 overflow-y-auto rounded-xl bg-popover p-1 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10"
    >
      {picker.items.map((row, index) => (
        <li
          key={row.tag}
          id={`${picker.listId}-${index}`}
          role="option"
          aria-selected={index === picker.active}
          className={cn(
            'flex cursor-default items-center gap-2 rounded-lg px-2.5 py-2',
            index === picker.active && 'bg-muted text-foreground',
          )}
          onMouseDown={(event) => {
            event.preventDefault();
            picker.pick(row);
          }}
        >
          {row.create ? (
            <span className="flex items-center gap-2 text-accent">
              <Plus className="size-4" aria-hidden />
              {t('addTagNamed', { tag: row.tag })}
            </span>
          ) : (
            <>
              <TagIcon className="size-3.5 text-text-muted" aria-hidden />
              <bdi className="min-w-0 flex-1 truncate">{row.tag}</bdi>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
// A tag is one capsule with its remove control inside it, at its end, the way a token field draws
// one; the control is a 24 px target that reddens under the pointer.
function TagChips({ tags, remove }: { tags: string[]; remove: (tag: string) => void }) {
  const t = useTranslations('common');
  return tags.map((tag) => (
    <span
      key={tag}
      className="inline-flex max-w-40 items-center gap-0.5 rounded-full bg-surface-raised py-0.5 ps-2.5 pe-0.5 text-xs text-text-muted"
    >
      <bdi className="truncate">{tag}</bdi>
      <button
        type="button"
        aria-label={t('removeTag', { tag })}
        className="flex size-5 shrink-0 items-center justify-center rounded-full text-text-faint hover:bg-danger-soft hover:text-danger"
        onClick={() => remove(tag)}
      >
        <X className="size-3" />
      </button>
    </span>
  ));
}
