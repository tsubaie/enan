// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import en from '@/core/i18n/messages/en.json';
import { ApiError } from '@/core/http/client';
import { EntityList } from '../EntityList';
import { EntityContent } from '../EntityContent';
import { testConfig, testController, testRow } from './fixtures';
// EP-B16: a list that failed says so where the rows would be, with the request id a reader can
// quote and a Retry that asks the same question again; a record that failed says so inside the
// panel, under the not-found line, with the way out beside it.
function mount(node: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>,
  );
}
const failure = new ApiError('internal', 'The list could not be loaded', {}, 'req-list-0042');
describe('entity error states', () => {
  afterEach(cleanup);
  it('EP-B16 the list error panel carries the message, the request id and a Retry that refetches', () => {
    const refetch = vi.fn();
    const config = testConfig();
    const controller = testController({
      list: { ...testController().list, error: failure, refetch },
    });
    mount(<EntityList config={config} controller={controller} />);
    const panel = screen.getByRole('alert');
    expect(within(panel).getByText(failure.message)).toBeTruthy();
    expect(within(panel).getByText('req-list-0042')).toBeTruthy();
    // The failure replaces the rows and the empty state alike: neither is drawn under it.
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(en.common.empty)).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: en.common.retry }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
  it('EP-B16 rows that did load are not shown over a failed refetch; the panel wins', () => {
    const config = testConfig();
    const controller = testController({
      list: { ...testController().list, items: [testRow('a', 'Alpha', 1)], error: failure },
    });
    mount(<EntityList config={config} controller={controller} />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Alpha' })).toBeNull();
  });
  it('EP-B16 a detail error is inline: the not-found line, the error with its request id, and Close', () => {
    const close = vi.fn();
    const config = testConfig();
    const detailFailure = new ApiError(
      'internal',
      'The record could not be loaded',
      {},
      'req-detail-7',
    );
    const controller = testController({
      close,
      state: { creating: false, id: 'a', view: 'all', q: '', sort: '', layout: '', focus: '' },
      detail: {
        data: undefined,
        pending: false,
        error: detailFailure,
        refetch: async () => undefined,
      },
    });
    mount(<EntityContent config={config} controller={controller} />);
    expect(screen.getByText(en.common.notFound)).toBeTruthy();
    const panel = screen.getByRole('alert');
    expect(within(panel).getByText(detailFailure.message)).toBeTruthy();
    expect(within(panel).getByText('req-detail-7')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: en.common.close }));
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('EP-B16 a loading detail shows its placeholder and no error until the answer arrives', () => {
    const config = testConfig();
    const controller = testController({
      state: { creating: false, id: 'a', view: 'all', q: '', sort: '', layout: '', focus: '' },
      detail: { data: undefined, pending: true, error: null, refetch: async () => undefined },
    });
    mount(<EntityContent config={config} controller={controller} />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(en.common.notFound)).toBeNull();
  });
});
