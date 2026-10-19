'use client';
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { cn } from '@/ui/cn';
import type { MentionItem } from './mentions';
import { characterBox } from './caret';
// The list while an "@" token is being typed, opened just under the "@" itself: its start edge on
// the "@" (the right edge in Arabic), kept inside the field. It is solid rather than glass because
// it opens inside the record sheet, where a second blur would not draw. Items select on mouse down
// so the textarea never loses focus; keyboard navigation is handled by the textarea itself.
export function MentionMenu({
  id,
  items,
  active,
  onPick,
  field,
  start,
}: {
  id: string;
  items: MentionItem[];
  active: number;
  onPick: (item: MentionItem) => void;
  field: RefObject<HTMLTextAreaElement | null>;
  start: number;
}) {
  const t = useTranslations('common');
  const list = useRef<HTMLUListElement>(null);
  useAnchor(field, list, start);
  return (
    <ul
      ref={list}
      id={id}
      role="listbox"
      aria-label={t('mentionPeople')}
      className="mention-menu absolute z-30 max-h-56 w-64 max-w-full overflow-y-auto rounded-xl p-1 text-sm"
    >
      {items.length === 0 && <li className="px-3 py-2 text-text-muted">{t('noMatches')}</li>}
      {items.map((item, index) => (
        <li
          key={item.id}
          id={`${id}-${index}`}
          role="option"
          aria-selected={index === active}
          className={cn(
            'cursor-default rounded-lg px-2.5 py-2',
            index === active && 'bg-muted text-foreground',
          )}
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(item);
          }}
        >
          {item.create ? (
            <span className="flex items-center gap-2 text-accent">
              <Plus className="size-4" aria-hidden />
              {t('mentionCreate', { name: item.name })}
            </span>
          ) : (
            <bdi>{item.name}</bdi>
          )}
        </li>
      ))}
    </ul>
  );
}
// sync: places the menu under the "@" at `start`, relative to the field's container, by writing
// its position straight onto the element as the text is laid out.
function useAnchor(
  field: RefObject<HTMLTextAreaElement | null>,
  list: RefObject<HTMLUListElement | null>,
  start: number,
) {
  useLayoutEffect(() => {
    const element = field.current;
    const menu = list.current;
    if (!element || !menu) return;
    const at = characterBox(element, start);
    const width = menu.offsetWidth;
    const from = element.offsetLeft;
    const to = from + element.clientWidth - width;
    const wanted = from + (at.rtl ? at.right - width : at.left);
    menu.style.setProperty('top', `${element.offsetTop + at.top + at.height + 4}px`);
    menu.style.setProperty('left', `${Math.max(from, Math.min(to, wanted))}px`);
  }, [field, list, start]);
}
