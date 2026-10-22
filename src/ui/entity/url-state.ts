const filterKeys = ['view', 'q', 'sort'];
export function resolveUrlState(params: URLSearchParams) {
  return {
    creating: params.get('new') === '1',
    id: params.get('new') === '1' ? null : params.get('id'),
    view: params.get('view') ?? 'all',
    q: params.get('q') ?? '',
    sort: params.get('sort') ?? '',
    layout: params.get('layout') ?? '',
    // EP-B44: the field of the open record shown in the expanded view, or empty.
    focus: params.get('focus') ?? '',
  };
}
export function changeUrl(params: URLSearchParams, patch: Record<string, string | null>) {
  const result = new URLSearchParams(params);
  for (const [key, value] of Object.entries(patch))
    if (value === null || value === '') result.delete(key);
    else result.set(key, value);
  // A search begun before a module default arrives stays in the visible All view.
  if ('q' in patch && !result.has('view')) result.set('view', 'all');
  if (patch.new === '1') result.delete('id');
  if (patch.id) result.delete('new');
  if (filterKeys.some((key) => key in patch)) {
    result.delete('sel');
    if (!patch.id) result.delete('id');
    if (!patch.new) result.delete('new');
  }
  if (leavesFocus(patch)) result.delete('focus');
  return result.toString();
}

// EP-B44: the expanded view belongs to one record, so it ends when the record or the list under it
// changes, unless the patch speaks for it.
function leavesFocus(patch: Record<string, string | null>) {
  return !('focus' in patch) && ['id', 'new', ...filterKeys].some((key) => key in patch);
}
// EP-B29: the layout is deliberately absent here. Clearing filters puts the reader back to the
// unfiltered list; it does not take away the presentation they chose to read it in.
export function clearEntityFilters(keys: string[]) {
  return Object.fromEntries([
    ...keys.map((key) => [key, null]),
    ['view', 'all'],
    ['q', null],
    ['sort', null],
    ['id', null],
    ['new', null],
    ['sel', null],
  ]);
}

// EP-A05: the selection with one row turned on or off, starting from the selection the address
// bar holds now. The controller's `selected` comes from useSearchParams, which Next 16.4 updates a
// render after the history entry is written, so two quick toggles that started from it would each
// overwrite the other and keep only the last row.
export function toggleSelection(search: string, id: string, on?: boolean) {
  const current = (new URLSearchParams(search).get('sel') ?? '').split(',').filter(Boolean);
  const selected = on ?? !current.includes(id);
  const next = current.filter((entry) => entry !== id);
  return (selected ? [...next, id] : next).join(',');
}

// EP-B30, #59: the address a navigation starts from, naming the module's default view when the
// address does not name one yet. The default is held in memory when it arrives and recorded only
// with the reader's next action, so it never races a navigation they already started.
export function withDefaultView(search: string, defaultView: string | null) {
  const params = new URLSearchParams(search);
  if (defaultView && !params.has('view') && !params.has('q')) params.set('view', defaultView);
  return params;
}
