'use client';
import { useId, type KeyboardEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { request } from '@/core/http/client';
import { Locale } from '@/core/config/defaults';
import { cn } from '@/ui/cn';
// 05 § Layout shell: the language is chosen beside the bell, as two flags in one capsule, rather
// than found behind the avatar. It is a radio group: one language is always the one in use, the
// other is one press away, and the arrow keys move between them the way any radio group does.
// Each option is named in its own language ("English", "العربية"), so a reader who cannot read
// the current one can still find theirs.
//
// The flags are drawn inline: the content security policy admits no remote image, and an emoji
// flag renders as two letters on most desktop systems. Their colours are the flags' own, fixed
// whatever the wallpaper, so they are named colours rather than theme tokens.
type Choice = z.infer<typeof Locale>;
const order: Choice[] = [Locale.enum.en, Locale.enum.ar];
const flags = { en: UnitedKingdomFlag, ar: SaudiArabiaFlag };

export function LanguageToggle() {
  const t = useTranslations('common');
  const current = useLocale();
  const names = { en: t('english'), ar: t('arabic') };
  const mutation = useMutation({
    mutationFn: (locale: Choice) =>
      request('/preferences', z.object({ data: z.null() }), { method: 'POST', body: { locale } }),
    onSuccess: () => location.reload(),
  });
  const choose = (locale: Choice) => {
    if (locale === current || mutation.isPending) return;
    mutation.mutate(locale);
  };
  // Selection follows focus, as in any radio group; with two options every arrow means "the other".
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const next = (index + 1) % order.length;
    const locale = order[next];
    if (!locale) return;
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLElement>('[role="radio"]')
      [next]?.focus();
    choose(locale);
  };
  return (
    <div className="relative">
      <div
        role="radiogroup"
        aria-label={t('language')}
        aria-busy={mutation.isPending}
        className="flex items-center gap-0.5 rounded-full border bg-surface/40 p-0.5"
      >
        {order.map((locale, index) => (
          <LanguageOption
            key={locale}
            locale={locale}
            name={names[locale]}
            checked={locale === current}
            pending={mutation.isPending}
            onChoose={() => choose(locale)}
            onKeyDown={(event) => onKeyDown(event, index)}
          />
        ))}
      </div>
      {mutation.isError && (
        <span
          role="alert"
          className="absolute end-0 top-full z-10 mt-1 rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap text-danger"
        >
          {mutation.error.message}
        </span>
      )}
    </div>
  );
}

function LanguageOption(props: {
  locale: Choice;
  name: string;
  checked: boolean;
  pending: boolean;
  onChoose: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const Flag = flags[props.locale];
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.checked}
      aria-disabled={props.pending || undefined}
      aria-label={props.name}
      lang={props.locale}
      tabIndex={props.checked ? 0 : -1}
      onClick={props.onChoose}
      onKeyDown={props.onKeyDown}
      className={cn(
        'grid size-8 place-items-center rounded-full outline-none transition-[background-color,opacity] pointer-coarse:size-11',
        'focus-visible:ring-3 focus-visible:ring-ring/50',
        props.checked ? 'bg-muted' : 'opacity-70 hover:bg-muted hover:opacity-100',
      )}
    >
      <Flag />
    </button>
  );
}

const flagClass = 'size-5 shrink-0 overflow-hidden rounded-full ring-1 ring-border';

// The Union Jack, the middle of its 2:1 field cropped to a circle: the blue ground, the white
// saltire with the red one counterchanged beside it, and the red cross on its white fimbriation.
function UnitedKingdomFlag() {
  const clip = `uk${useId().replace(/[^\w-]/gu, '')}`;
  return (
    <svg viewBox="15 0 30 30" aria-hidden={true} focusable="false" className={flagClass}>
      <clipPath id={clip}>
        <path d="M30 15h30v15zv15H0zH0V0zV0h30z" />
      </clipPath>
      <rect width="60" height="30" fill="var(--flag-uk-blue)" />
      <path d="M0 0l60 30m0-30L0 30" stroke="var(--flag-white)" strokeWidth="6" />
      <path d="M0 0l60 30m0-30L0 30" stroke="var(--flag-uk-red)" strokeWidth="4" clipPath={`url(#${clip})`} />
      <path d="M30 0v30M0 15h60" stroke="var(--flag-white)" strokeWidth="10" />
      <path d="M30 0v30M0 15h60" stroke="var(--flag-uk-red)" strokeWidth="6" />
    </svg>
  );
}

// The Saudi flag at this size: the green field, the shahada as a line of script-like strokes, and
// the sword beneath it, its hilt toward the fly.
function SaudiArabiaFlag() {
  return (
    <svg viewBox="0 0 30 30" aria-hidden={true} focusable="false" className={flagClass}>
      <rect width="30" height="30" fill="var(--flag-sa-green)" />
      <g fill="none" stroke="var(--flag-white)" strokeLinecap="round" strokeWidth="1.3">
        <path d="M7 14.5c1.5 1.2 3 1.2 4 0s2.5-1.2 4 0 2.5 1.2 4 0 2.5-1.2 4 0" />
        <path d="M9 13V9.5M13 13V10.5M16.5 13V9M20.5 13V10.5" />
        <path d="M6.5 19.5c3 .9 10 .9 14.5 0" />
        <path d="M21 18v3M21 19.5h2.5" />
      </g>
    </svg>
  );
}
