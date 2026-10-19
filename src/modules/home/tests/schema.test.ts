import { expect, it } from 'vitest';
import { z } from 'zod';
import { Home } from '../schema/validation';
const base = { name: 'Reader', principal: null, peopleCount: 0 };
const noteId = '01a09ec1-bcde-7715-bec0-f0c3ae4dbd01';
it('HOME-B01 HOME-B03 a section carries its count and its way in, and the facts a row may lack default to absent', () => {
  const parsed = Home.parse({
    ...base,
    sections: [
      {
        key: 'notes',
        enabled: true,
        count: 1,
        href: '/notes?view=this_week',
        items: [{ id: noteId, title: 'Weekly briefing', href: `/notes?view=all&id=${noteId}` }],
      },
      { key: 'nextMeetings', enabled: false, count: 0 },
    ],
  });
  // A provider that has no ageing split, no week and no facts beyond the title sends none, and
  // the page still receives every field it reads.
  expect(parsed.sections[1]).toEqual({
    key: 'nextMeetings',
    enabled: false,
    count: 0,
    href: null,
    stale: null,
    days: null,
    items: [],
  });
  expect(parsed.sections[0]?.items[0]).toEqual({
    id: noteId,
    title: 'Weekly briefing',
    href: `/notes?view=all&id=${noteId}`,
    date: null,
    owner: null,
    committee: null,
    count: null,
    revision: null,
    overdue: null,
    done: null,
    status: null,
    ratio: null,
  });
});
it('HOME-B06 HOME-B01 the section list is the spec’s ten minus the two without a provider, in the spec’s order, and no other key is accepted', () => {
  expect(Home.shape.sections.element.shape.key.options).toEqual([
    'nextMeetings',
    'prep',
    'overdue',
    'today',
    'waiting',
    'committees',
    'kpis',
    'initiatives',
    'notes',
  ]);
  const unknown = Home.safeParse({
    ...base,
    sections: [{ key: 'meetings', enabled: true, count: 0 }],
  });
  expect(unknown.success).toBe(false);
  expect(unknown.error?.issues[0]?.path).toEqual(['sections', 0, 'key']);
});
it('HOME-B14 HOME-B10 a day needs an ISO date and a way in, and a row needs a key even when it is not a record', () => {
  const section = { key: 'today', enabled: true, count: 0, href: '/tasks?view=today' };
  const week = (days: z.infer<ReturnType<typeof z.json>>[]) =>
    Home.safeParse({ ...base, sections: [{ ...section, days }] }).success;
  expect(week([{ date: '2026-09-14', count: 0, href: '/tasks?view=all&due=2026-09-14' }])).toBe(
    true,
  );
  expect(week([{ date: '14/09/2026', count: 0, href: '/tasks?view=all&due=2026-09-14' }])).toBe(
    false,
  );
  expect(week([{ date: '2026-09-14', count: 0 }])).toBe(false);
  const row = (id: string) =>
    Home.safeParse({
      ...base,
      sections: [
        { ...section, key: 'waiting', items: [{ id, title: '', href: '/tasks?view=waiting' }] },
      ],
    }).success;
  // The chase list's unassigned row is keyed by a word rather than a record id (HOME-B10).
  expect(row('unassigned')).toBe(true);
  expect(row('')).toBe(false);
});
