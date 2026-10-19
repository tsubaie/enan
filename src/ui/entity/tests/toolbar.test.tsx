// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import en from '@/core/i18n/messages/en.json';
import { EntityToolbar } from '../EntityControls';
import { EntityEmpty } from '../EntityStates';
import type { EntityController } from '../use-entity-controller';
import { testConfig, testController, type TestRow } from './fixtures';
// EP-B33: a sort reorders the list and never shortens it, so it is not a filter anywhere the bar
// or the empty state speaks of filters. EP-B34: while a record is open the panel covers the end of
// the list, so the bar carries only search and Filter; the rest is absent rather than hidden.
function mount(node: ReactNode) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={en}
      formats={{ number: { integer: { maximumFractionDigits: 0 } } }}
    >
      {node}
    </NextIntlClientProvider>,
  );
}
const views = [
  { id: 'all', label: 'All measures' },
  { id: 'stale', label: 'Stale' },
];
const sort = {
  default: '',
  options: [
    { id: '', label: 'Default order' },
    { id: 'name', label: 'By name' },
  ],
};
const facets = [
  {
    key: 'owner',
    label: 'Owner',
    options: [
      { value: '', label: 'Anyone' },
      { value: 'me', label: 'Me' },
    ],
  },
];
const idle: EntityController<TestRow, object, object>['state'] = {
  creating: false,
  id: null,
  view: 'all',
  q: '',
  sort: '',
  layout: '',
  focus: '',
};
function surface(state: Partial<typeof idle>, facetValues: Record<string, string> = { owner: '' }) {
  const config = testConfig({
    filters: { views, sort, facets },
    bulkActions: [{ id: 'archive', label: 'Archive', run: async () => undefined }],
  });
  const controller = testController({ state: { ...idle, ...state }, facets: facetValues });
  return { config, controller };
}
describe('entity toolbar', () => {
  afterEach(cleanup);
  it('EP-B33 a chosen sort is not counted on the Filter button, a facet is', () => {
    const sorted = surface({ sort: 'name' });
    const { unmount } = mount(<EntityToolbar {...sorted} />);
    expect(screen.getByRole('button', { name: en.common.filter })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /·/u })).toBeNull();
    unmount();
    const filtered = surface({ sort: 'name' }, { owner: 'me' });
    mount(<EntityToolbar {...filtered} />);
    // One facet on, one counted; the sort beside it adds nothing to the figure.
    expect(screen.getByRole('button', { name: 'Filters · 1' })).toBeTruthy();
  });
  it('EP-B33 a sorted but unfiltered empty list is empty, not "no matches"', () => {
    const sorted = surface({ sort: 'name' });
    const { unmount } = mount(<EntityEmpty {...sorted} />);
    expect(screen.getByRole('heading', { name: en.common.empty })).toBeTruthy();
    expect(screen.getByRole('button', { name: en.common.create })).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.common.clear })).toBeNull();
    unmount();
    // A facet does shorten the list, so under one the same emptiness is "no matches" with Clear.
    const filtered = surface({ sort: 'name' }, { owner: 'me' });
    mount(<EntityEmpty {...filtered} />);
    expect(screen.getByRole('heading', { name: en.common.noMatches })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: en.common.clear }));
    expect(filtered.controller.clearFilters).toHaveBeenCalledTimes(1);
  });
  it('EP-B34 with no record open the bar carries search, Filter, sort, selection mode and Clear', () => {
    const closed = surface({});
    mount(<EntityToolbar {...closed} />);
    expect(screen.getByRole('textbox', { name: closed.config.searchLabel })).toBeTruthy();
    expect(screen.getByRole('button', { name: en.common.filter })).toBeTruthy();
    expect(screen.getByLabelText(en.common.sort)).toBeTruthy();
    expect(screen.getByRole('button', { name: en.common.select })).toBeTruthy();
    expect(screen.getByRole('button', { name: en.common.clear })).toBeTruthy();
  });
  it('EP-B34 while a record is open only search and Filter remain; the list-wide settings are absent, not hidden', () => {
    const open = surface({ id: 'a' });
    mount(<EntityToolbar {...open} />);
    expect(screen.getByRole('textbox', { name: open.config.searchLabel })).toBeTruthy();
    expect(screen.getByRole('button', { name: en.common.filter })).toBeTruthy();
    expect(screen.queryByLabelText(en.common.sort)).toBeNull();
    expect(screen.queryByRole('button', { name: en.common.select })).toBeNull();
    expect(screen.queryByRole('button', { name: en.common.clear })).toBeNull();
    // Absent from the document, so there is no phantom tab stop under the panel.
    expect(
      document.querySelectorAll('.entity-toolbar [hidden], .entity-toolbar .invisible'),
    ).toHaveLength(0);
  });
  it('EP-B34 the create form covers the list the same way and takes the same controls with it', () => {
    const creating = surface({ creating: true });
    mount(<EntityToolbar {...creating} />);
    expect(screen.queryByLabelText(en.common.sort)).toBeNull();
    expect(screen.queryByRole('button', { name: en.common.select })).toBeNull();
    expect(screen.getByRole('button', { name: en.common.filter })).toBeTruthy();
  });
});
