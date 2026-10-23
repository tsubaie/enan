import { expect, it } from 'vitest';
import { pathOf, type Filter } from '../../ui/AuditLogPage';

// ADMIN-B72, ADMIN-B73: what the audit page asks the server for, from what the reader picked.
// Days are counted from the workspace's today, here Thursday 23 October 2026.
const today = '2026-10-23';
const filter = (fields: Partial<Filter>): Filter => ({
  type: 'all',
  done: 'all',
  when: 'any',
  from: null,
  to: null,
  ...fields,
});

it('ADMIN-B72 ADMIN-B73 nothing picked asks for the log as it is; a kind and an action narrow it', () => {
  expect(pathOf(filter({}), today)).toBe('audit');
  expect(pathOf(filter({ type: 'kpis', done: 'removed' }), today)).toBe(
    'audit?type=kpis&change=removed',
  );
  // A sign-in neither adds, edits nor deletes, so the action is not sent with it.
  expect(pathOf(filter({ type: 'sign_in', done: 'added' }), today)).toBe('audit?type=sign_in');
});

it('ADMIN-B73 each span is whole days counted from today, and a custom range is sent as picked', () => {
  const span = (when: Filter['when'], fields: Partial<Filter> = {}) =>
    pathOf(filter({ when, ...fields }), today).replace('audit?', '');
  expect(span('today')).toBe('from=2026-10-23&to=2026-10-23');
  expect(span('yesterday')).toBe('from=2026-10-22&to=2026-10-22');
  expect(span('days7')).toBe('from=2026-10-17&to=2026-10-23');
  expect(span('days30')).toBe('from=2026-09-24&to=2026-10-23');
  expect(span('this_month')).toBe('from=2026-10-01&to=2026-10-23');
  expect(span('last_month')).toBe('from=2026-09-01&to=2026-09-30');
  expect(span('custom', { from: '2026-08-01', to: null })).toBe('from=2026-08-01');
});
