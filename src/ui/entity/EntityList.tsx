'use client';
import { ShowMore } from '@/ui/layout/ShowMore';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import { cn } from '@/ui/cn';
import type { Entity } from './types';
import type { Surface } from './surface';
import { groupTail } from './rows';
import { EntityListRow } from './EntityListRow';
import { useRowMotion, type Rendered } from './use-row-motion';
import { EntityTable } from './EntityTable';
import { EntityListSkeleton, EntityEmpty } from './EntityStates';
import { useListReorder, type RowReorder } from './use-row-reorder';
export function EntityList<T extends Entity, P extends object, C>(props: Surface<T, P, C>) {
  const { list } = props.controller;
  const rows = useRowMotion(list.items, list.pending);
  if (list.pending)
    return <EntityListSkeleton cards={props.config.renderers.rowStyle === 'card'} />;
  if (list.error) return <ErrorPanel error={list.error} retry={list.refetch} />;
  if (!rows.length) return <EntityEmpty {...props} />;
  // EP-B29: the table is the same records, the same selection and the same keyboard; only the
  // arrangement differs, so it branches here rather than anywhere the rest of the surface can see.
  if (props.controller.state.layout === 'table' && props.config.renderers.columns?.length)
    return (
      <>
        <EntityTable {...props} rows={rows} />
        <ShowMore shown={list.items.length} more={list.more} onMore={list.fetchMore} />
      </>
    );
  return (
    <>
      {props.config.reorder ? (
        <ReorderedRows {...props} rows={rows} />
      ) : (
        <EntityRows {...props} rows={rows} reorder={null} />
      )}
      <ShowMore
        shown={list.items.length}
        more={list.more}
        onMore={list.fetchMore}
        peek={list.peek && <PeekRow {...props} rows={rows} peek={list.peek} />}
      />
    </>
  );
}
// EP-B47: the next row drawn as the list draws it, after the rows shown, so a group heading appears
// only when the next row starts a new group. ShowMore makes it inert and fades it.
function PeekRow<T extends Entity, P extends object, C>(
  props: Surface<T, P, C> & { rows: Rendered<T>[]; peek: T },
) {
  const row = { item: props.peek, leaving: false, entering: false };
  return (
    <ul data-entity-rows>
      <EntityListRow
        {...props}
        rows={[...props.rows, row]}
        row={row}
        index={props.rows.length}
        reorder={null}
      />
    </ul>
  );
}
// EP-B46: only a list that can be reordered takes the reorder state, so a list without it never
// asks for the toasts the reorder reports through.
function ReorderedRows<T extends Entity, P extends object, C>(
  props: Surface<T, P, C> & { rows: Rendered<T>[] },
) {
  const reorder = useListReorder(props.config, props.controller);
  return <EntityRows {...props} reorder={reorder} />;
}
function EntityRows<T extends Entity, P extends object, C>({
  rows,
  reorder,
  ...props
}: Surface<T, P, C> & { rows: Rendered<T>[]; reorder: RowReorder | null }) {
  return (
    // EP-B27: the grid is declared on the list itself and its column count comes from container
    // queries, so it answers to the width the list actually has rather than to the window's.
    // `data-entity-rows` is how the keyboard finds the track count without being told it.
    <ul
      data-entity-rows
      className={cn(
        props.config.renderers.rowStyle === 'grid' &&
          'entity-grid grid items-stretch gap-3 p-3 @2xl:grid-cols-2 @5xl:grid-cols-3',
      )}
    >
      {ordered(rows, reorder?.order ?? null).map((row, index, shown) => (
        <EntityListRow
          key={row.item.id}
          {...props}
          rows={shown}
          row={row}
          index={index}
          reorder={reorder}
          tail={
            props.config.renderers.rowStyle === 'grid' ? groupTail(props, shown, index) : undefined
          }
        />
      ))}
    </ul>
  );
}
// The rows in the order they are being moved into, while the write is under way.
function ordered<T extends Entity>(rows: Rendered<T>[], order: string[] | null) {
  if (!order) return rows;
  const byId = new Map(rows.map((row) => [row.item.id, row]));
  const placed = order.map((id) => byId.get(id)).filter((row): row is Rendered<T> => Boolean(row));
  return [...placed, ...rows.filter((row) => !order.includes(row.item.id))];
}
