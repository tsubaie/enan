// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/core/i18n/messages/en.json';
import ar from '@/core/i18n/messages/ar.json';
import { ShowMore, useShowMore } from '@/ui/layout/ShowMore';

afterEach(cleanup);
const mount = (node: React.ReactNode, locale: 'en' | 'ar' = 'en') =>
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'ar' ? ar : en}>
      {node}
    </NextIntlClientProvider>,
  );

const nextRow = 'Next row';
it('EP-B47 a list with more shows a button and how many are shown, and the next row faded and out of reach', () => {
  const onMore = vi.fn();
  mount(
    <ShowMore
      shown={5}
      total={24}
      more
      onMore={onMore}
      peek={<button type="button">{nextRow}</button>}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: en.common.more }));
  expect(onMore).toHaveBeenCalledOnce();
  expect(screen.getByRole('status').textContent).toBe('Showing 5 of 24');
  // The peek is drawn but is not part of the list: no pointer, no keyboard, no screen reader.
  const peek = screen.getByText(nextRow).closest('.show-more-peek');
  expect(peek?.hasAttribute('inert')).toBe(true);
  expect(peek?.getAttribute('aria-hidden')).toBe('true');
  expect(screen.queryByRole('button', { name: nextRow })).toBeNull();
});

it('EP-B47 without a total it says how many are shown, in Arabic too, and a list with no more shows nothing', () => {
  mount(<ShowMore shown={20} more onMore={() => {}} />, 'ar');
  expect(screen.getByRole('status').textContent).toBe('يُعرض 20');
  cleanup();
  const { container } = mount(<ShowMore shown={3} total={3} more={false} onMore={() => {}} />);
  expect(container.textContent).toBe('');
});

it('EP-B47 a list on hand shows a step at a time, the next row as its peek', () => {
  const rows = Array.from({ length: 12 }, (_, index) => index);
  const { result } = renderHook(() => useShowMore(rows, 5));
  expect(result.current.visible).toEqual([0, 1, 2, 3, 4]);
  expect(result.current.peek).toBe(5);
  expect(result.current.props).toMatchObject({ shown: 5, total: 12, more: true });
  act(() => void result.current.props.onMore());
  act(() => void result.current.props.onMore());
  expect(result.current.visible).toHaveLength(12);
  expect(result.current.peek).toBeUndefined();
  expect(result.current.props.more).toBe(false);
});
