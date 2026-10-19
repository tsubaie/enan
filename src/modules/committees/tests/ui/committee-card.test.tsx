// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import en from '@/core/i18n/messages/en.json';
import ar from '@/core/i18n/messages/ar.json';
import { request } from '@/core/http/client';
import type { DetailApi } from '@/ui/entity/types';
import { Committee, type CommitteePatch } from '../../schema/validation';
import { useCommitteeColumns } from '../../ui/CommitteeColumns';
import { CommitteeChip } from '../../ui/CommitteePicker';
import { CommitteeDetail } from '../../ui/CommitteeDetail';
import { mount } from './harness';
vi.mock('@/core/http/client', () => ({ request: vi.fn() }));
// The tabs reuse the other modules' embedded lists (COMM-B03); here they stand in for themselves
// so the scenario reads what the committee hands them rather than rendering a whole list page.
vi.mock('@/modules/tasks/ui', () => ({
  CommitteeTasks: ({ committeeId, allowCreate }: { committeeId: string; allowCreate: boolean }) => (
    <div data-testid="committee-tasks" data-allow-create={String(allowCreate)}>
      {committeeId}
    </div>
  ),
}));
vi.mock('@/modules/notes/ui', () => ({
  CommitteeNotes: ({ committeeId }: { committeeId: string }) => (
    <div data-testid="committee-notes">{committeeId}</div>
  ),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const committee = Committee.parse({
  id: '01a0a000-0000-7000-8000-0000000000c1',
  revision: 2,
  name: 'Finance committee',
  description: '',
  ownership: 'Board of directors',
  scope: 'internal',
  status: 'active',
  sortOrder: 0,
  createdAt: '2026-09-01T07:00:00.000Z',
  updatedAt: '2026-09-09T07:00:00.000Z',
  createdBy: null,
  updatedBy: null,
  deletedAt: null,
  deletedOpId: null,
  stats: { open: 2, completed: 1, overdue: 2, today: 1 },
  lastNoteDate: '2026-09-05',
});
// Every column rendered as the card's trailing strip would, one cell per fact.
function Cells({ item }: { item: Committee }) {
  const columns = useCommitteeColumns();
  return (
    <dl>
      {columns.map((column) => (
        <div key={column.key}>
          <dt>{column.head}</dt>
          <dd data-testid={column.key}>{column.cell(item)}</dd>
        </div>
      ))}
    </dl>
  );
}
describe.each(['en', 'ar'] as const)('committee card (%s)', (locale) => {
  const t = locale === 'ar' ? ar : en;
  it('COMM-B02 COMM-B05 a card states the name, scope, ownership, task progress, overdue count, last note and status', () => {
    mount(<Cells item={committee} />, locale);
    expect(screen.getByText('Finance committee')).toBeTruthy();
    expect(screen.getByTestId('scope').textContent).toBe(t.committees.internal);
    expect(screen.getByText('Board of directors')).toBeTruthy();
    // Completed over everything the committee holds: 1 of 3, in the locale's numerals.
    const digits = (value: number) => new Intl.NumberFormat(locale).format(value);
    expect(screen.getByTestId('tasks').textContent).toBe(`${digits(1)}/${digits(3)}`);
    expect(screen.getByTestId('overdue').textContent).toBe(digits(2));
    const note = within(screen.getByTestId('lastNote')).getByRole('time');
    expect(note.getAttribute('datetime')).toBe('2026-09-05');
    expect(note.textContent).toContain('2026');
    expect(screen.getByTestId('status').textContent).toBe(t.committees.active);
    expect(screen.getByText(t.committees.lastNoteColumn)).toBeTruthy();
  });
});
it('COMM-B02 a card with nothing late and no note leaves those cells empty rather than printing a zero', () => {
  mount(
    <Cells
      item={{
        ...committee,
        status: 'archived',
        stats: { open: 0, completed: 0, overdue: 0, today: 0 },
        lastNoteDate: null,
      }}
    />,
  );
  expect(screen.getByTestId('overdue').textContent).toBe('');
  expect(screen.getByTestId('lastNote').textContent).toBe('');
  expect(screen.getByTestId('tasks').textContent).toBe('0/0');
  expect(screen.getByTestId('status').textContent).toBe(en.committees.archived);
});
it('COMM-I03 COMM-B03 the chip on a task names its committee and says so when that committee is archived or in the trash', () => {
  const reference = {
    id: committee.id,
    name: 'Finance committee',
    status: 'active',
    deleted: false,
  };
  mount(<CommitteeChip committee={reference} />);
  const live = screen.getByRole('link', { name: 'Finance committee' });
  expect(live.getAttribute('href')).toContain(committee.id);
  expect(live.getAttribute('href')).toContain('view=all');
  mount(<CommitteeChip committee={{ ...reference, status: 'archived' }} />);
  expect(
    screen.getByRole('link', { name: `Finance committee (${en.committees.archived})` }),
  ).toBeTruthy();
  mount(<CommitteeChip committee={{ ...reference, deleted: true }} />, 'ar');
  const trashed = screen.getByRole('link', {
    name: `Finance committee (${ar.committees.trash})`,
  });
  expect(trashed.getAttribute('href')).toContain('view=trash');
});
it("COMM-B03 COMM-A05 the detail offers Tasks, Notes and Activity tabs that reuse the other modules' lists and read the audit feed", async () => {
  vi.mocked(request).mockResolvedValue({
    data: [
      {
        id: '01a0a000-0000-7000-8000-0000000000a1',
        action: 'create',
        entityType: 'task',
        entityId: '01a0a000-0000-7000-8000-000000000002',
        createdAt: '2026-09-09T07:00:00.000Z',
      },
      {
        id: '01a0a000-0000-7000-8000-0000000000a2',
        action: 'archive',
        entityType: 'committee',
        entityId: committee.id,
        createdAt: '2026-09-08T07:00:00.000Z',
      },
    ],
    meta: { nextCursor: null },
  });
  const api: DetailApi<Omit<CommitteePatch, 'revision'>> = {
    save: vi.fn(),
    remove: vi.fn(),
    restore: vi.fn(),
    close: vi.fn(),
    saveState: 'idle',
    retry: vi.fn(),
    next: vi.fn(),
    prev: vi.fn(),
    neighbors: { previous: false, next: false, position: 1, count: 1 },
    focus: { key: '', set: vi.fn() },
  };
  mount(<CommitteeDetail committee={{ ...committee, status: 'archived' }} api={api} />);
  const tabs = screen.getByRole('tablist', { name: en.committees.linkedWork });
  expect(
    within(tabs)
      .getAllByRole('tab')
      .map((tab) => tab.textContent),
  ).toEqual([en.committees.tasks, en.committees.notes, en.committees.activity]);
  // The Tasks tab is the tasks module's own embedded list, scoped to this committee, and an
  // archived body cannot receive new work from it.
  const tasks = screen.getByTestId('committee-tasks');
  expect(tasks.textContent).toBe(committee.id);
  expect(tasks.getAttribute('data-allow-create')).toBe('false');
  fireEvent.click(within(tabs).getByRole('tab', { name: en.committees.activity }));
  await waitFor(() =>
    expect(
      screen.getByText(`${en.committees.taskEntity} · ${en.committees.actionCreate}`),
    ).toBeTruthy(),
  );
  expect(
    screen.getByText(`${en.committees.committee} · ${en.committees.actionArchive}`),
  ).toBeTruthy();
  expect(vi.mocked(request).mock.calls[0]?.[0]).toBe(`/committees/${committee.id}/activity`);
});
