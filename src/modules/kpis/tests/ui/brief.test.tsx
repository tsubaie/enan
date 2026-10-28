// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import en from '@/core/i18n/messages/en.json';
import { KpiDetail, type Narrative } from '../../schema/validation';
import { KpiNarrative } from '../../ui/KpiNarrative';
import { TargetDelta, TrailingStrip } from '../../ui/KpiReadingHints';
import { KpiReminder } from '../../ui/KpiReminder';
import { mount } from './harness';
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ replace: () => {} }),
  usePathname: () => '/kpis',
}));
const KPI = '01a08a9f-1991-760a-b73a-568f6f866500';
const OWNER = '01a08a9f-1991-760a-b73a-568f6f866501';
const brief: Narrative = {
  id: '01a08a9f-1991-760a-b73a-568f6f866502',
  kpiId: null,
  objectiveId: null,
  locale: 'en',
  periodMode: 'current',
  dataHash: 'a'.repeat(64),
  status: 'ready',
  headline: 'One measure is off target.',
  bodyMarkdown: 'Board pack on time reads 40.',
  highlights: [
    { kpiId: KPI, code: 'K1', name: 'Board pack on time', status: 'off_target', summary: 'Late.' },
  ],
  error: null,
  createdAt: '2026-09-10T07:00:00.000Z',
};
// The page's reads, answered from memory: AI availability, the brief and the owner facets.
function serve(stale: boolean) {
  const body = (path: string) => {
    if (path.startsWith('/api/v1/ai/availability'))
      return { data: { capabilities: ['kpis.narrative'], configured: true, canConfigure: false } };
    if (path.startsWith('/api/v1/kpis/narrative'))
      return {
        data: {
          narrative: brief,
          currentDataHash: stale ? 'b'.repeat(64) : brief.dataHash,
          isStale: stale,
        },
      };
    return {
      data: [],
      categories: [],
      objectives: [],
      owners: [{ id: OWNER, name: 'Holding Owner', hasLogin: false }],
    };
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => new Response(JSON.stringify(body(path)), { status: 200 })),
  );
}
beforeEach(() => serve(false));
afterEach(() => vi.unstubAllGlobals());
it('KPIS-B32 the brief opens from one control and cites each measure as a link to it', async () => {
  mount(<KpiNarrative />);
  const toggle = await screen.findByRole('button', { name: new RegExp(en.kpis.briefOpen, 'u') });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(toggle);
  expect(await screen.findByText(brief.headline ?? '')).toBeTruthy();
  expect(screen.getByText(en.kpis.briefGrounded)).toBeTruthy();
  const cited = screen.getByRole('link', { name: /K1/u });
  expect(cited.getAttribute('href')).toBe(`/kpis?id=${KPI}`);
  expect(screen.getByRole('group', { name: en.kpis.briefLanguage })).toBeTruthy();
});
it('KPIS-B32 a brief whose figures have moved says so', async () => {
  serve(true);
  mount(<KpiNarrative />);
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(en.kpis.briefOpen, 'u') }));
  expect(await screen.findByText(en.kpis.briefStale)).toBeTruthy();
});
const detail = KpiDetail.parse({
  id: KPI,
  revision: 1,
  name: 'Board pack on time',
  unit: 'points',
  direction: 'higher',
  frequency: 'quarterly',
  category: '',
  objectiveId: null,
  objectiveName: null,
  objectiveDeleted: false,
  ownerId: OWNER,
  ownerName: 'Holding Owner',
  notes: '',
  sortOrder: 0,
  createdAt: '2026-09-01T07:00:00.000Z',
  updatedAt: '2026-09-01T07:00:00.000Z',
  createdBy: null,
  updatedBy: null,
  deletedAt: null,
  deletedOpId: null,
  meta: {
    current: 42,
    currentDate: '2026-06-09',
    previous: null,
    percentChange: null,
    effectiveTarget: 50,
    effectiveTargetPeriod: { year: 2026, period: 3 },
    status: 'near_target',
    achievement: 0.84,
    sparkline: [],
  },
  readings: [
    {
      id: KPI,
      revision: 1,
      readingDate: '2026-06-09',
      value: 42,
      note: '',
      future: false,
      createdAt: '2026-06-09T07:00:00.000Z',
    },
  ],
  targets: [{ id: KPI, year: 2026, period: 3, targetValue: 50 }],
  previousPeriod: null,
  periods: [],
});
it('KPIS-B30 KPIS-B31 the reading dialog shows the three periods before it, N/A where unread', () => {
  mount(<TrailingStrip kpi={detail} day="2026-09-10" />);
  const strip = screen.getByRole('list', { name: en.kpis.trailingPeriods });
  expect(strip.textContent).toContain('Q4 2025');
  expect(strip.textContent).toContain('42 pts');
  expect(screen.getAllByText(en.kpis.notAvailable)).toHaveLength(2);
});
it('KPIS-B30 the figure being typed is read against its period target as it is typed', () => {
  mount(<TargetDelta kpi={detail} day="2026-09-10" value="55" />);
  expect(screen.getByRole('status').textContent).toBe('+5 pts against the 50 pts target');
  mount(<TargetDelta kpi={detail} day="2026-09-10" value="" />);
  expect(screen.queryByRole('status')).toBeNull();
});
it('KPIS-B30 the reminder switch says when its owner has no login to reach', async () => {
  mount(<KpiReminder initial={{ ...detail, remindersEnabled: true }} save={() => {}} />);
  await waitFor(() =>
    expect(
      screen.getByText('Holding Owner has no workspace login, so no reminder can reach them.'),
    ).toBeTruthy(),
  );
});
