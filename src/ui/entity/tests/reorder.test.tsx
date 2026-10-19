// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/core/i18n/messages/en.json';
import { ToastHost } from '@/ui/layout/toast/ToastHost';
import { EntityList } from '../EntityList';
import { testConfig, testController, testRow, type TestRow } from './fixtures';
// EP-B46: a list the reader orders by hand. Two groups, so the boundary between them is exercised:
// Alpha and Bravo share one, Charlie is alone in the other.
const rows = [testRow('a', 'Alpha', 1), testRow('b', 'Bravo', 1), testRow('c', 'Charlie', 2)];
beforeAll(() => {
  // jsdom has neither; the glide is decoration and is not what these scenarios check.
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
  Object.defineProperty(Element.prototype, 'animate', { value: vi.fn(), configurable: true });
});
afterEach(cleanup);
function mount(commit: (items: TestRow[]) => Promise<void>, active = true) {
  const base = testController();
  const controller = testController({ list: { ...base.list, items: rows } });
  const config = testConfig({
    group: (item) => String(item.score),
    reorder: { active: () => active, commit, handle: (item) => item.name },
  });
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ToastHost>
        <EntityList config={config} controller={controller} />
      </ToastHost>
    </NextIntlClientProvider>,
  );
}
const earlier = (name: string) =>
  screen.getByRole('button', { name: `Move ${name} one place earlier` });
const later = (name: string) =>
  screen.getByRole('button', { name: `Move ${name} one place later` });
const order = () =>
  screen.getAllByRole('button', { name: /^(Alpha|Bravo|Charlie)$/ }).map((b) => b.textContent);
describe('entity reorder', () => {
  it('EP-B46 each row offers earlier and later, and a row can never leave its group', () => {
    mount(vi.fn(async () => undefined));
    expect(earlier('Alpha').hasAttribute('disabled')).toBe(true);
    expect(later('Alpha').hasAttribute('disabled')).toBe(false);
    // Bravo is the last of its group: later would carry it into Charlie's.
    expect(later('Bravo').hasAttribute('disabled')).toBe(true);
    expect(earlier('Charlie').hasAttribute('disabled')).toBe(true);
    expect(later('Charlie').hasAttribute('disabled')).toBe(true);
  });
  it('EP-B46 moving a row writes its group in the new order and confirms it was saved', async () => {
    const commit = vi.fn(async () => undefined);
    mount(commit);
    fireEvent.click(later('Alpha'));
    expect(commit).toHaveBeenCalledWith([rows[1], rows[0]]);
    expect(order()).toEqual(['Bravo', 'Alpha', 'Charlie']);
    await waitFor(() => expect(screen.getByText(en.common.orderSaved)).toBeTruthy());
  });
  it('EP-B46 a failed write says so and the rows go back to their saved order', async () => {
    mount(vi.fn(async () => Promise.reject(new Error('conflict'))));
    fireEvent.click(earlier('Bravo'));
    await waitFor(() => expect(screen.getByText(en.common.orderNotSaved)).toBeTruthy());
    expect(order()).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });
  it('EP-B46 a list that is not in its own order offers no move buttons', () => {
    mount(
      vi.fn(async () => undefined),
      false,
    );
    expect(screen.queryByRole('button', { name: /one place/ })).toBeNull();
  });
});
