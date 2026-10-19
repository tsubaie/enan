'use client';
import { useTranslations } from 'next-intl';
import { useCount } from '@/ui/format';
import { Row } from './HomeRow';
import { Tile, TileHead } from './HomeTile';
import type { Section } from './home-sections';

// HOME-B01: overdue and due today answer the same question — what do I have to do — and are one
// view in Tasks, so they are one tile with two bands. It is the page's real work, so it comes
// first in the reading order at every width (HOME-B07), and like every tile it is drawn only when
// it has something in it (HOME-B02).
export function Actions({ bands, className }: { bands: Section[]; className?: string }) {
  const t = useTranslations('home');
  const count = useCount();
  const href = bands.find((section) => section.key === 'today')?.href ?? bands[0]?.href ?? null;
  const total = bands.reduce((sum, section) => sum + section.count, 0);
  return (
    <Tile className={className}>
      <TileHead title={t('actions')} href={href}>
        <span
          key={total}
          className="count-tick shrink-0 text-sm font-light tabular-nums text-text-muted"
        >
          {count(total)}
        </span>
      </TileHead>
      {bands
        .filter((section) => section.count > 0)
        .map((section) => (
          <Band key={section.key} section={section} />
        ))}
    </Tile>
  );
}
// HOME-B09: a band's head is one quiet line — its name and its count, and for the overdue band how
// much of it is a month or more late, as a muted suffix. The danger tone is the week's capsule's.
function BandHead({ section }: { section: Section }) {
  const t = useTranslations('home');
  const count = useCount();
  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5 pt-1 pb-1 text-xs font-light text-text-muted">
      <span>{t(section.key)}</span>
      <span aria-hidden>·</span>
      <span key={section.count} className="count-tick tabular-nums">
        {count(section.count)}
      </span>
      {section.stale ? (
        <>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{t('staleOverdue', { count: section.stale })}</span>
        </>
      ) : null}
    </p>
  );
}
function Band({ section }: { section: Section }) {
  return (
    <div className="mt-3">
      <BandHead section={section} />
      <ul className="divide-y divide-border/70">
        {section.items.map((item) => (
          <li key={item.id}>
            <Row item={item} sectionKey={section.key} />
          </li>
        ))}
      </ul>
    </div>
  );
}
