// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastHost } from '@/ui/layout/toast/ToastHost';
// The page is exercised without its network layer: the query hook is the only seam, so each
// scenario supplies the aggregated payload directly. The translator echoes its key plus the count
// it was given, so a scenario can assert which fact a row chose to show.
const { query } = vi.hoisted(() => ({ query: { current: {} as HomeQuery } }));
vi.mock('next-intl', () => {
  type Values = { count?: number | string; percent?: string };
  const echo = (key: string, values?: Values) =>
    values?.count === undefined
      ? values?.percent === undefined
        ? key
        : `${key}=${values.percent}`
      : `${key}=${values.count}`;
  const t = Object.assign(echo, { rich: echo });
  return { useLocale: () => 'en', useTranslations: () => t };
});
vi.mock('@/ui/format', () => ({
  useCount: () => (value: number) => String(value),
  initials: (name: string) => name.slice(0, 2).toUpperCase(),
  usePlainDate: () => (value: string) => value,
  useLongDate: () => (value: string) => `long:${value}`,
  useWeekday: () => (value: string) => `weekday:${value}`,
  useDayOfMonth: () => (value: string) => value.slice(-2),
  useToday: () => '2026-09-14',
  useDecimal: () => (value: number) => String(value),
  usePercent: () => (value: number) => `${Math.round(value * 100)}%`,
  useSignedPercent: () => (value: number) => String(value),
  useMonth: () => (value: number) => String(value),
  useMonthYear: () => (year: number, month: number) => `${year}-${month}`,
  useYear: () => (value: number) => String(value),
  plainDateValue: (day: string) => {
    const [year = 1970, month = 1, date = 1] = day.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, date));
  },
}));
vi.mock('../../ui/queries', () => ({ useHome: () => query.current }));
// Home's links prefetch on intent through the router (IntentLink); rendering needs only its shape.
vi.mock('next/navigation', () => ({ useRouter: () => ({ prefetch: () => undefined }) }));
import { HomePage } from '../../ui/HomePage';
type Item = {
  id: string;
  title: string;
  href: string;
  date: string | null;
  owner: string | null;
  committee: string | null;
  count: number | null;
  revision: number | null;
  overdue: number | null;
  done: number | null;
  status: string | null;
  ratio: number | null;
};
type Day = { date: string; count: number };
type Section = {
  key: string;
  enabled: boolean;
  count: number;
  href: string | null;
  items: Item[];
  stale: number | null;
  days: Day[] | null;
};
type HomeQuery = {
  isPending: boolean;
  error: Error | null;
  data?: {
    data: { name: string; principal: string | null; peopleCount: number; sections: Section[] };
  };
};
let seq = 0;
const item = (title: string, facts: Partial<Item> = {}): Item => ({
  id: `01a09ec1-bcde-7715-bec0-f0c3ae4dbd${String(seq++).padStart(2, '0')}`,
  title,
  href: `/open/${seq}`,
  date: null,
  owner: null,
  committee: null,
  count: null,
  revision: null,
  overdue: null,
  done: null,
  status: null,
  ratio: null,
  ...facts,
});
const section = (key: string, enabled: boolean, count = 0, items: Item[] = []): Section => ({
  key,
  enabled,
  count,
  href: enabled ? `/${key}` : null,
  items,
  stale: null,
  days: null,
});
const week = (counts: number[]) =>
  counts.map((count, index) => {
    const date = `2026-09-${String(14 + index).padStart(2, '0')}`;
    return { date, count, href: `/tasks?view=all&due=${date}` };
  });
// The completion control talks to the shared query client and reports itself through the shared
// toast viewport (TASKS-B02), so scenarios render inside both, the way the app mounts them.
const mount = (node: React.ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ToastHost>{node}</ToastHost>
    </QueryClientProvider>,
  );
function show(sections: Section[]) {
  query.current = {
    isPending: false,
    error: null,
    data: { data: { name: 'Preview Administrator', principal: null, peopleCount: 4, sections } },
  };
  return mount(<HomePage />);
}

afterEach(() => cleanup());
const tiles = (container: HTMLElement) => [...container.querySelectorAll('.home-tile')];
const tileNamed = (container: HTMLElement, name: string) =>
  tiles(container).find((tile) => tile.querySelector('h2')?.textContent?.startsWith(name));
it('HOME-B02 omits sections whose module is not installed', () => {
  show([
    section('overdue', true, 2, [item('Overdue report', { date: '2026-09-02' })]),
    section('today', true, 0),
    section('nextMeetings', false),
    section('kpis', false),
  ]);
  expect(screen.queryByText('nextMeetings')).toBeNull();
  expect(screen.queryByText('kpis')).toBeNull();
  expect(screen.queryByText('emptyHint')).toBeNull();
});
it('HOME-B02 shows one empty state instead of an empty box when no module is installed', () => {
  show([section('nextMeetings', false), section('kpis', false), section('initiatives', false)]);
  expect(screen.getByText('empty')).toBeTruthy();
  expect(screen.getByText('emptyHint')).toBeTruthy();
});
it('HOME-B02 draws no tile for an empty section and names the empty ones in one quiet line', () => {
  const { container } = show([
    section('overdue', true, 0),
    section('today', true, 0),
    section('waiting', true, 1, [item('Leila Haddad', { owner: 'Leila Haddad', count: 1 })]),
    section('committees', true, 0),
    section('notes', true, 0),
  ]);
  // Only the week and Waiting on are tiles; Actions, committees and notes have nothing in them.
  expect(tiles(container).map((tile) => tile.querySelector('h2')?.textContent)).toEqual([
    'weekweekDue=0',
    'waiting',
  ]);
  const quiet = container.querySelector('.home-quiet');
  expect(quiet?.textContent).toBe('quiet_actions, quiet_committees, and quiet_notes.');
});
it('HOME-B07 HOME-B05 the headline counts what is on the page, each count a link into that work', () => {
  show([
    section('overdue', true, 6, [item('Late', { date: '2026-09-02' })]),
    section('today', true, 2, [item('Due now')]),
    section('waiting', true, 6, [item('Leila Haddad', { owner: 'Leila Haddad', count: 6 })]),
    section('kpis', true, 3, [item('Coverage', { status: 'off_target', ratio: 0.5 })]),
  ]);
  const headline = screen.getByRole('heading', { level: 1 });
  // Due today, overdue and KPIs — the counts of the tiles below; waiting work is not counted.
  expect(headline.textContent).toBe(
    'headline_today=2, headline_overdue=6, and headline_kpis=3 headline_tail=11',
  );
  const links = within(headline).getAllByRole('link');
  expect(links.map((link) => link.getAttribute('href'))).toEqual(['/today', '/overdue', '/kpis']);
});
it('HOME-B07 says nothing needs the principal only when nothing is due, overdue or off track', () => {
  show([
    section('overdue', true, 0),
    section('today', true, 0),
    section('waiting', true, 2, [item('Leila Haddad', { owner: 'Leila Haddad', count: 2 })]),
    section('kpis', true, 0),
  ]);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('headline_clear');
});
it('HOME-B07 falls back to the standing subtitle when the due-today section is not installed', () => {
  show([section('committees', true, 1, [item('Audit Committee', { count: 2 })])]);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('title');
});
it('HOME-B07 the date line names the weekday', () => {
  show([section('today', true, 0)]);
  expect(screen.getByText('long:2026-09-14')).toBeTruthy();
});
it('HOME-B07 the Actions tile comes first, and the week follows it', () => {
  const { container } = show([
    { ...section('today', true, 1, [item('Due now')]), days: week([1, 0, 0, 0, 0, 0, 0]) },
    section('waiting', true, 1, [item('Leila Haddad', { owner: 'Leila Haddad', count: 2 })]),
    section('kpis', true, 1, [item('Coverage', { status: 'off_target', ratio: 0.5 })]),
    section('committees', true, 1, [item('Audit Committee', { count: 3 })]),
    section('notes', true, 1, [item('Weekly briefing', { date: '2026-09-13' })]),
  ]);
  const headings = [...container.querySelectorAll('.home-column > .home-tile h2')].map(
    (node) => node.textContent,
  );
  expect(headings[0]).toBe('actions');
  expect(headings[1]).toContain('week');
  expect(headings.slice(2)).toEqual(['waiting', 'kpis', 'committees', 'notes']);
});
it('HOME-B15 the Actions tile runs down beside every row, and an odd last tile closes its row', () => {
  const { container } = show([
    section('overdue', true, 1, [item('Late letter', { date: '2026-09-02' })]),
    { ...section('today', true, 0), days: week([0, 0, 0, 0, 0, 0, 0]) },
    section('waiting', true, 1, [item('Leila Haddad', { owner: 'Leila Haddad', count: 2 })]),
    section('kpis', true, 1, [item('Coverage', { status: 'off_target', ratio: 0.5 })]),
    section('notes', true, 1, [item('Weekly briefing', { date: '2026-09-13' })]),
  ]);
  // The week's row, then two rows of tiles beside Actions.
  expect(tileNamed(container, 'actions')?.className).toContain('lg:row-span-3');
  expect(tileNamed(container, 'notes')?.className).toContain('lg:col-span-2');
  expect(tileNamed(container, 'waiting')?.className).toContain('lg:col-span-1');
});
it('HOME-B15 every block is one glass tile that does not itself answer the pointer', () => {
  const { container } = show([
    section('overdue', true, 1, [item('Late letter', { date: '2026-09-02' })]),
    { ...section('today', true, 0), days: week([0, 0, 0, 0, 0, 0, 0]) },
    section('waiting', true, 1, [item('Leila Haddad', { owner: 'Leila Haddad', count: 2 })]),
  ]);
  expect(container.querySelector('.home-page')).toBeTruthy();
  const all = tiles(container);
  expect(all).toHaveLength(3);
  for (const tile of all) {
    expect(tile.className).toContain('entity-glass');
    expect(tile.className).toContain('glass-static');
  }
  // Rows take the shared panel-row wash.
  for (const row of container.querySelectorAll('.home-tile li > div'))
    expect(row.className).toContain('hover:bg-[var(--nav-hover)]');
});
it('HOME-B15 the headline and tile headings align to the reading start, nothing is centred but the day cells', () => {
  const { container } = show([
    section('overdue', true, 1, [item('Late letter', { date: '2026-09-02' })]),
    { ...section('today', true, 1, [item('Due now')]), days: week([1, 0, 0, 0, 0, 0, 0]) },
    section('waiting', true, 1, [item('Leila Haddad', { owner: 'Leila Haddad', count: 2 })]),
  ]);
  expect(screen.getByRole('heading', { level: 1 }).className).toContain('text-start');
  for (const heading of container.querySelectorAll('.home-tile h2'))
    expect(heading.className).toContain('text-start');
  const physical = container.querySelectorAll('.text-left, .text-right');
  expect(physical).toHaveLength(0);
  for (const node of container.querySelectorAll('.text-center'))
    expect(node.closest('.home-lead li')).toBeTruthy();
});
it('HOME-B14 draws the seven days with their due counts and keeps what is late out of the row', () => {
  const { container } = show([
    { ...section('overdue', true, 3, [item('Late', { date: '2026-09-02' })]), stale: 1 },
    { ...section('today', true, 2, [item('Due now')]), days: week([2, 0, 1, 0, 0, 4, 1]) },
  ]);
  const lead = container.querySelector('.home-lead') ?? container;
  const cells = within(lead as HTMLElement).getAllByRole('listitem');
  expect(cells).toHaveLength(7);
  expect(cells[0]?.getAttribute('aria-current')).toBe('date');
  expect(cells[0]?.textContent).toContain('weekday:2026-09-14');
  expect(cells[0]?.textContent).toContain('due=2');
  expect(
    within(cells[0] as HTMLElement)
      .getByRole('link')
      .getAttribute('href'),
  ).toBe('/tasks?view=all&due=2026-09-14');
  // The overdue count is a capsule in the head, not a cell, and opens the overdue view.
  const capsule = within(lead as HTMLElement).getByRole('link', { name: 'weekOverdue=3' });
  expect(capsule.getAttribute('href')).toBe('/overdue');
  expect(capsule.closest('li')).toBeNull();
  expect(within(lead as HTMLElement).getByRole('heading', { level: 2 }).textContent).toContain(
    'weekDue=8',
  );
});
it('HOME-B14 a week with nothing due collapses to its head, with the overdue capsule kept', () => {
  const { container } = show([
    section('overdue', true, 2, [item('Late', { date: '2026-09-02' })]),
    { ...section('today', true, 0), days: week([0, 0, 0, 0, 0, 0, 0]) },
  ]);
  const lead = container.querySelector('.home-lead') as HTMLElement;
  expect(within(lead).queryAllByRole('listitem')).toHaveLength(0);
  expect(within(lead).getByRole('link', { name: 'weekOverdue=2' })).toBeTruthy();
});
it('HOME-B01 draws overdue and due today as one Actions tile with quiet bands', () => {
  const { container } = show([
    { ...section('overdue', true, 3, [item('Late letter', { date: '2026-09-02' })]), stale: 2 },
    section('today', true, 1, [item('Read the pack')]),
  ]);
  const actions = tileNamed(container, 'actions') as HTMLElement;
  expect(actions.querySelector('h2')?.parentElement?.textContent).toContain('4');
  expect(within(actions).getByText('overdue')).toBeTruthy();
  expect(within(actions).getByText('today')).toBeTruthy();
  // HOME-B09: the ageing split is a muted suffix, with no bar and no danger ink.
  const stale = within(actions).getByText('staleOverdue=2');
  expect(stale.closest('p')?.className).toContain('text-text-muted');
  expect(actions.querySelector('svg.meter-fill, .text-danger')).toBeNull();
});
it('HOME-B01 does not draw a band that has nothing in it', () => {
  show([
    section('overdue', true, 0),
    section('today', true, 2, [item('Read the pack'), item('Sign the memo')]),
  ]);
  expect(screen.queryByText('overdue')).toBeNull();
  expect(screen.getByText('today')).toBeTruthy();
});
it('HOME-B01 shows how late an overdue row is and what a committee carries', () => {
  show([
    section('overdue', true, 1, [item('Late letter', { date: '2026-09-02' })]),
    section('committees', true, 1, [item('Audit Committee', { count: 3 })]),
  ]);
  expect(screen.getByText('daysLate=12')).toBeTruthy();
  expect(screen.getByText('openWork=3')).toBeTruthy();
});
it('HOME-B01 a KPI row leads with its reason and states its share of the target, with no ring', () => {
  const { container } = show([
    section('kpis', true, 2, [
      item('Strategic budget committed', {
        committee: 'Deliver the strategy',
        status: 'off_target',
        ratio: 0.48,
      }),
      item('Regional coverage', { status: 'stale', ratio: null }),
    ]),
  ]);
  const link = screen.getByRole('link', { name: /Strategic budget/u });
  expect(link.firstElementChild?.textContent).toBe('off_target');
  expect(screen.getByText('ofTarget=48%')).toBeTruthy();
  expect(screen.queryByText('Deliver the strategy')).toBeNull();
  expect(screen.getByText('stale')).toBeTruthy();
  expect(container.querySelectorAll('.meter-arc')).toHaveLength(0);
});
it('HOME-B01 a KPI without a reading says so', () => {
  show([
    section('kpis', true, 1, [item('Partner satisfaction', { status: 'no_data', ratio: null })]),
  ]);
  expect(screen.getByText('noReading')).toBeTruthy();
  expect(screen.getByText('no_data')).toBeTruthy();
});
it('HOME-B01 titles wrap to two lines and keep their whole text on the link', () => {
  const name = 'A committee name long enough to be clamped in the row of its tile';
  const { container } = show([section('committees', true, 1, [item(name, { count: 1 })])]);
  expect(screen.getByTitle(name)).toBeTruthy();
  expect(container.querySelector('.home-title')?.textContent).toBe(name);
  expect(container.querySelector('.truncate.home-title')).toBeNull();
});
it('HOME-B10 a waiting row is the person, then what they hold, how much is late and since when', () => {
  const { container } = show([
    section('waiting', true, 4, [
      item('Leila Haddad', { owner: 'Leila Haddad', count: 3, date: '2026-09-01', overdue: 2 }),
      item('Omar Nasser', { owner: 'Omar Nasser', count: 1, date: '2026-09-20', overdue: 0 }),
    ]),
  ]);
  const leila = screen.getByRole('link', { name: /Leila Haddad/u });
  expect(leila.textContent).toContain('holding=3');
  expect(leila.textContent).toContain('lateOpen=2');
  // The oldest is thirteen days past due: said as lateness, not as a past date.
  expect(leila.textContent).toContain('daysLate=13');
  expect(leila.textContent).not.toContain('earliestDue');
  // Nothing late yet: the first due date is the fact.
  const omar = screen.getByRole('link', { name: /Omar Nasser/u });
  expect(omar.textContent).toContain('earliestDue');
  expect(screen.queryByText('lateOpen=0')).toBeNull();
  // No unscaled bars beside the figures.
  expect(container.querySelectorAll('.meter-fill')).toHaveLength(0);
  expect(leila.getAttribute('href')).toMatch(/^\/open\//u);
});
it('HOME-B10 names the unassigned row in the chase list and gives it an empty face', () => {
  show([
    section('waiting', true, 3, [
      item('Leila Haddad', { owner: 'Leila Haddad', count: 1 }),
      item('', { id: 'unassigned', owner: null, count: 2, date: '2026-09-20' }),
    ]),
  ]);
  expect(screen.getByText('unassigned')).toBeTruthy();
  expect(screen.getByTitle('unassigned')).toBeTruthy();
  expect(screen.getByText('holding=2')).toBeTruthy();
});
it('HOME-B09 says nothing about ageing when nothing has aged', () => {
  show([{ ...section('overdue', true, 5, [item('Late', { date: '2026-09-02' })]), stale: 0 }]);
  expect(screen.queryByText('staleOverdue=0')).toBeNull();
});
it("HOME-B09 shows a committee's late share beside its open work", () => {
  show([section('committees', true, 1, [item('Audit', { count: 4, overdue: 2 })])]);
  expect(screen.getByText('lateOpen=2')).toBeTruthy();
});
it('HOME-B04 renders a shaped skeleton rather than collapsing the layout while loading', () => {
  query.current = { isPending: true, error: null };
  mount(<HomePage />);
  expect(screen.getByRole('status')).toBeTruthy();
});
it('HOME-B08 a count that changes is replaced rather than swapped in silence', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const data = (count: number) => ({
    isPending: false as const,
    error: null,
    data: {
      data: {
        name: 'Preview Administrator',
        principal: null,
        peopleCount: 4,
        sections: [section('today', true, count, [item('Approve the catalogue', { revision: 3 })])],
      },
    },
  });
  query.current = data(2);
  const tree = () => (
    <QueryClientProvider client={client}>
      <ToastHost>
        <HomePage />
      </ToastHost>
    </QueryClientProvider>
  );
  const view = render(tree());
  const before = screen.getAllByText('2');
  expect(before.length).toBeGreaterThan(0);
  for (const node of before) expect(node.className).toContain('count-tick');
  query.current = data(1);
  view.rerender(tree());
  expect(screen.getAllByText('1').length).toBeGreaterThan(0);
  for (const node of before) expect(node.isConnected).toBe(false);
});
it('HOME-B08 offers a completion control on task rows and nothing to complete elsewhere', () => {
  show([
    section('today', true, 1, [item('Approve the catalogue', { revision: 3 })]),
    section('committees', true, 1, [item('Audit Committee', { count: 2 })]),
  ]);
  expect(screen.getAllByRole('checkbox')).toHaveLength(1);
});
it('HOME-B12 only the headline enters; no tile, row or mark animates on arrival', () => {
  const { container } = show([
    { ...section('overdue', true, 2, [item('Late letter', { date: '2026-09-02' })]), stale: 1 },
    { ...section('today', true, 1, [item('Due now')]), days: week([1, 0, 0, 0, 0, 0, 0]) },
    section('committees', true, 1, [item('Audit Committee', { count: 3, done: 1 })]),
  ]);
  expect(screen.getByRole('heading', { level: 1 }).className).toContain('home-headline');
  expect(container.querySelectorAll('.home-headline')).toHaveLength(1);
  expect(container.querySelectorAll('.home-rise, .home-lead-rows')).toHaveLength(0);
});
it('HOME-B16 one quick capture opens the task list’s own create sheet', () => {
  show([section('today', true, 0)]);
  expect(screen.getByRole('button', { name: /addTask/u }).getAttribute('href')).toBe(
    '/tasks?new=1',
  );
});
it('HOME-B11 (removed) the page carries no way into the people directory', () => {
  // Removed at the owner's request: People is reached from the side menu, not from Home.
  show([section('today', true, 0)]);
  expect(document.querySelector('a[href="/people"]')).toBeNull();
});
it('HOME-B05 the page no longer names whom it is preparing for', () => {
  query.current = {
    isPending: false,
    error: null,
    data: {
      data: {
        name: 'Preview Administrator',
        principal: 'Sample Principal',
        peopleCount: 4,
        sections: [section('today', true, 0)],
      },
    },
  };
  mount(<HomePage />);
  expect(screen.queryByText(/preparing/u)).toBeNull();
});
it('HOME-A01 HOME-B01 HOME-B03 every "View all" opens its module in the section’s own view', () => {
  const late = item('Late letter', { date: '2026-09-02' });
  show([
    section('overdue', true, 1, [late]),
    section('today', true, 0),
    section('waiting', true, 1, [item('Leila Haddad', { owner: 'Leila Haddad', count: 1 })]),
    section('committees', true, 1, [item('Audit Committee', { count: 3 })]),
    section('kpis', true, 1, [item('Coverage', { status: 'off_target', ratio: 0.5 })]),
    section('notes', true, 1, [item('Weekly briefing', { date: '2026-09-13' })]),
  ]);
  const hrefs = screen
    .getAllByRole('link', { name: 'viewAll' })
    .map((link) => link.getAttribute('href'))
    .sort();
  expect(hrefs).toEqual(['/committees', '/kpis', '/notes', '/today', '/waiting']);
  expect(screen.getByRole('link', { name: /Late letter/u }).getAttribute('href')).toBe(late.href);
});
it('HOME-A04 HOME-A05 HOME-A07 a committee, an overdue row and a holder each state their fact', () => {
  show([
    section('overdue', true, 1, [item('Late letter', { date: '2026-09-11' })]),
    section('waiting', true, 2, [
      item('Omar Nasser', { owner: 'Omar Nasser', count: 2, overdue: 0 }),
    ]),
    section('committees', true, 1, [
      item('Consumer protection', { count: 2, overdue: 1, done: 0 }),
    ]),
  ]);
  expect(screen.getByRole('link', { name: /Late letter/u }).textContent).toContain('daysLate=3');
  expect(screen.getByRole('link', { name: /Omar Nasser/u }).textContent).toContain('holding=2');
  const committee = screen.getByRole('link', { name: /Consumer protection/u });
  expect(committee.textContent).toContain('openWork=2');
  expect(committee.textContent).toContain('lateOpen=1');
});
