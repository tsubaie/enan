// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/core/i18n/messages/en.json';
import { ToastHost } from '@/ui/layout/toast/ToastHost';
import { EntityNavigationProvider } from '../navigation';
import { EntityPanel } from '../EntityPanel';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
afterEach(cleanup);
const item = {
  id: '01a0a000-0000-7000-8000-000000000003',
  revision: 1,
  deletedAt: null,
  deletedOpId: null,
};
function mount() {
  const close = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ToastHost>
        <EntityNavigationProvider>
          <EntityPanel
            item={item}
            name="Review the Q4 board pack"
            deletedMessage={en.tasks.deletedToast}
            mutations={{ patch: vi.fn(), create: vi.fn(), remove: vi.fn(), restore: vi.fn() }}
            render={() => null}
            reload={vi.fn().mockResolvedValue(item)}
            close={close}
            move={vi.fn()}
            neighbors={{ previous: false, next: false, position: 1, count: 1 }}
          />
        </EntityNavigationProvider>
      </ToastHost>
    </NextIntlClientProvider>,
  );
  return close;
}
it('EP-B38 the record offers one way out, a close cross, and it leaves the record', async () => {
  const close = mount();
  const cross = screen.getByRole('button', { name: en.common.close });
  // One control, so nothing offers the same action twice under two names.
  expect(screen.queryByRole('button', { name: en.common.back })).toBeNull();
  // Leaving settles pending saves first (EP-B11), so the exit lands a tick later.
  cross.click();
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
});
it('EP-B38 the cross is at the end edge of the bar', () => {
  mount();
  const cross = screen.getByRole('button', { name: en.common.close });
  const controls = [...(cross.parentElement?.querySelectorAll('button') ?? [])];
  // Document order is the logical order, which is what makes the RTL mirror free.
  expect(controls.at(-1)).toBe(cross);
});
