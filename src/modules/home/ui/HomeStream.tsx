'use client';
import { useTranslations } from 'next-intl';
import { useCount } from '@/ui/format';
import { Row } from './HomeRow';
import { Tile, TileHead } from './HomeTile';
import type { Section } from './home-sections';

// One section as a widget (HOME-B15): the heading and its count, then up to five rows with
// hairlines between them, the one place a rule is drawn (docs/design-system.md § 7). Reference
// material (recent notes) keeps the same tile and takes a quieter heading. A section with nothing
// in it never reaches here: it is named in the page's quiet line instead (HOME-B02).
export function Stream({
  section,
  quiet = false,
  className,
}: {
  section: Section;
  quiet?: boolean;
  className?: string;
}) {
  const t = useTranslations('home');
  const count = useCount();
  return (
    <Tile className={className}>
      <TileHead title={t(section.key)} href={section.href} quiet={quiet}>
        <span
          key={section.count}
          className="count-tick shrink-0 text-sm font-light tabular-nums text-text-muted"
        >
          {count(section.count)}
        </span>
      </TileHead>
      <Items section={section} />
    </Tile>
  );
}
function Items({ section }: { section: Section }) {
  return (
    <ul className="mt-2 divide-y divide-border/70">
      {section.items.map((item) => (
        <li key={item.id}>
          <Row item={item} sectionKey={section.key} />
        </li>
      ))}
    </ul>
  );
}
