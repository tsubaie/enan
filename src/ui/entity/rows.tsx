import { useCount } from '@/ui/format';
import { cn } from '@/ui/cn';
import type { Entity } from './types';
import type { Surface } from './surface';
import type { Rendered } from './use-row-motion';
import { toggleSelection } from './url-state';
// The two things every arrangement of rows has to work out for itself, kept in one place so a list
// and a table cannot drift apart on either: what selecting a row does to the URL, and whether this
// row is the one that opens a group.
export function selectRow<T extends Entity, P extends object, C>(
  c: Surface<T, P, C>['controller'],
  id: string,
  checked: boolean,
) {
  c.navigate({ sel: toggleSelection(window.location.search, id, checked) }, true);
}
// EP-B14: a heading only means something while the list is in the order the grouping describes.
// Once the reader has chosen a sort of their own the rows no longer arrive grouped and the headings
// would repeat down the page marking nothing, so a sort suppresses them outright. The count is of
// the rows loaded under this heading, and a row on its way out is not one of them.
export function groupAt<T extends Entity, P extends object, C>(
  { config, controller: c }: Surface<T, P, C>,
  rows: Rendered<T>[],
  index: number,
) {
  const item = rows[index]?.item;
  const before = rows[index - 1]?.item;
  const heading = item && !c.state.sort ? config.group?.(item) : null;
  if (!heading || (before && heading === config.group?.(before))) return null;
  return {
    heading,
    size: rows.filter((row) => !row.leaving && config.group?.(row.item) === heading).length,
  };
}

// A tile that leaves a hole on its row: the only tile in its group, or a group's last tile in an
// odd place. tokens.css spans it across the row at the column counts where the hole appears.
export function groupTail<T extends Entity, P extends object, C>(
  { config, controller: c }: Surface<T, P, C>,
  rows: Rendered<T>[],
  index: number,
) {
  const key = (at: number) => {
    const item = rows[at]?.item;
    return item && !c.state.sort ? config.group?.(item) : null;
  };
  if (index < rows.length - 1 && key(index + 1) === key(index)) return undefined;
  let start = index;
  while (start > 0 && key(start - 1) === key(index)) start -= 1;
  if (start === index) return 'alone';
  return (index - start) % 2 === 0 ? 'odd' : undefined;
}

// How many cells stand before the first column of a table: the selection box and the row action,
// each only while it is showing.
export function leadingCells<T extends Entity, P extends object, C>({
  config,
  controller: c,
}: Surface<T, P, C>) {
  return (config.bulkActions?.length && c.selecting ? 1 : 0) + (config.rowAction ? 1 : 0);
}
// EP-B14: one heading, in whichever shape the rows around it are taking. A table's has to be a row
// spanning every column or the grouping sits outside the table it groups; a grid's has to span
// every track; and either way it is a sibling of the rows rather than a block inside the first of
// them, so a row fading out never takes its heading with it.
export function EntityGroupHeading<T extends Entity, P extends object, C>(
  surface: Surface<T, P, C> & { rows: Rendered<T>[]; index: number },
) {
  const { config, controller: c, rows, index } = surface;
  const count = useCount();
  const group = groupAt(surface, rows, index);
  if (!group) return null;
  const size = count(group.size);
  if (c.state.layout === 'table' && config.renderers.columns?.length)
    return (
      <TableGroupHeading
        heading={group.heading}
        size={size}
        span={leadingCells(surface) + config.renderers.columns.length}
      />
    );
  if (config.renderers.rowStyle === 'grid')
    return (
      <li className="col-span-full flex items-center gap-2.5 pt-3">
        <h2 className="font-display text-heading leading-none">{group.heading}</h2>
        <GroupCount size={size} />
      </li>
    );
  if (config.renderers.rowStyle === 'card') {
    const item = rows[index]?.item;
    return (
      <CardGroupHeading
        heading={group.heading}
        size={size}
        tone={item ? (config.groupTone?.(item) ?? null) : null}
      />
    );
  }
  return <LineGroupHeading heading={group.heading} size={size} />;
}
type Heading = { heading: string; size: string };
function TableGroupHeading({ heading, size, span }: Heading & { span: number }) {
  return (
    <tr>
      <th
        scope="colgroup"
        colSpan={span}
        className="border-b bg-surface-raised/60 px-3 py-1.5 text-start text-[11px] font-semibold tracking-wider text-text-muted uppercase"
      >
        <span className="flex items-center gap-2">
          {heading}
          <GroupCount size={size} />
        </span>
      </th>
    </tr>
  );
}
// ADR 0030: in a card list the heading is the structure of the list, so it is set to be read -- the
// display face at the heading step, in the tone the group carries -- rather than as a label over
// the rows. Without a tone it is ink.
function CardGroupHeading({ heading, size, tone }: Heading & { tone: 'accent' | 'danger' | null }) {
  return (
    <li>
      <h2
        className={cn(
          'flex items-center gap-2.5 px-4 pt-6 pb-2.5 font-display text-heading leading-none',
          tone === 'danger' && 'text-danger',
          tone === 'accent' && 'text-accent',
          !tone && 'text-text',
        )}
      >
        {heading}
        <GroupCount size={size} tone={tone} />
      </h2>
    </li>
  );
}
function LineGroupHeading({ heading, size }: Heading) {
  return (
    <li>
      <h2 className="flex h-7 items-center gap-2 border-b bg-surface-raised/60 px-4 text-[11px] leading-none font-semibold tracking-wider text-text-muted uppercase">
        {heading}
        <GroupCount size={size} />
      </h2>
    </li>
  );
}
// How many rows a group holds, as a small capsule beside its heading, in every arrangement of the
// list (docs/design-system.md § Chips and tags). It takes the group's tone, so the count of what is
// late is red and of what is due today is the accent; any other group's count is neutral grey.
function GroupCount({ size, tone = null }: { size: string; tone?: 'accent' | 'danger' | null }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-sans text-[11px] leading-none font-medium tracking-normal normal-case tabular-nums',
        tone === 'danger' && 'bg-danger-soft text-danger',
        tone === 'accent' && 'bg-accent-soft text-accent',
        !tone && 'bg-surface-raised text-text-muted',
      )}
    >
      {size}
    </span>
  );
}
