// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import en from '@/core/i18n/messages/en.json';
import ar from '@/core/i18n/messages/ar.json';
import { DesktopPlacement, MobilePlacement } from '@/core/config/capture-placement';
import { MobileNav } from '@/ui/layout/MobileNav';
import { AccountPanel } from '@/ui/layout/AccountPanel';
import { Popover } from '@/ui/primitives/popover';
import { captureEntries, type CaptureEntries } from '../../ui/entries';
import { CaptureEntry } from '../../ui/CaptureEntry';
import type { CaptureSetup } from '../../schema/validation';
import { mount } from '../../../../../tests/fixtures/mount';
// CAPTURES-B17 CAPTURES-B18: which way to record lands in which slot of the shell, and how each
// variant behaves. The recorder is a spy: what is checked is that a control asks for it.
const spies = vi.hoisted(() => ({ start: vi.fn(), pending: 0, active: false }));
vi.mock('../../ui/capture-store', () => ({
  startCapture: spies.start,
  useCaptureActive: () => spies.active,
}));
vi.mock('../../ui/capture-queries', () => ({
  useCaptureCount: () => ({ data: { data: { pending: spies.pending } } }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/home',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
beforeEach(() => {
  spies.start.mockReset();
  spies.pending = 0;
  spies.active = false;
});
afterEach(() => vi.unstubAllGlobals());
const setup = (overrides: Partial<CaptureSetup> = {}): CaptureSetup => ({
  allowed: true,
  enabled: true,
  shortcut: true,
  mobile: 'floating-end',
  desktop: 'header',
  ...overrides,
});
const slots = (entries: CaptureEntries) =>
  Object.entries(entries)
    .filter(([, node]) => node !== null)
    .map(([slot]) => slot)
    .sort();
const matrix = MobilePlacement.options.flatMap((mobile) =>
  DesktopPlacement.options.flatMap((desktop) =>
    [true, false].map((enabled) => ({ mobile, desktop, enabled })),
  ),
);
it.each(matrix)(
  'CAPTURES-B17 CAPTURES-B18 phone $mobile, computer $desktop, enabled $enabled: one phone surface, at most one computer surface',
  ({ mobile, desktop, enabled }) => {
    const filled = slots(captureEntries(setup({ mobile, desktop, enabled })));
    if (!enabled) return expect(filled).toEqual([]);
    const phone = mobile === 'more' ? ['more', 'moreDot'] : ['floating'];
    const computer = desktop === 'header' ? ['header'] : desktop === 'account-menu' ? ['menu'] : [];
    expect(filled).toEqual([...phone, ...computer].sort());
  },
);
it('CAPTURES-B17 the circle sits at the logical end or start, never left or right, and starts recording', () => {
  for (const [mobile, edge] of [
    ['floating-end', 'end-4'],
    ['floating-start', 'start-4'],
  ] as const) {
    const view = mount(<>{captureEntries(setup({ mobile })).floating}</>);
    const circle = screen.getByRole('button', { name: en.captures.recordNote });
    expect(circle.classList.contains(edge)).toBe(true);
    expect(circle.className).not.toMatch(/\b(left|right)-/u);
    expect(circle.classList.contains('lg:hidden')).toBe(true);
    expect(circle.hasAttribute('data-capture-opener')).toBe(true);
    expect(circle.hasAttribute('data-capture-fab')).toBe(true);
    fireEvent.click(circle);
    view.unmount();
  }
  expect(spies.start).toHaveBeenCalledTimes(2);
});
it('CAPTURES-B17 the circle goes while a recording is active', () => {
  spies.active = true;
  mount(<CaptureEntry.Floating side="end" />);
  expect(screen.queryByRole('button', { name: en.captures.recordNote })).toBeNull();
});
const moreNav = (mobile: CaptureSetup['mobile']) => {
  const entries = captureEntries(setup({ mobile }));
  return mount(<MobileNav role="member" action={entries.more} dot={entries.moreDot} />);
};
it('CAPTURES-B17 In More is the first action of the sheet, closes it and starts recording in the same click', () => {
  spies.pending = 3;
  moreNav('more');
  const door = screen.getByRole('button', { name: new RegExp(en.common.navMore, 'u') });
  expect(door.hasAttribute('data-capture-opener')).toBe(true);
  fireEvent.click(door);
  const sheet = screen.getByRole('dialog');
  const actions = within(sheet).getAllByRole('button');
  const record = within(sheet).getByRole('button', {
    name: new RegExp(en.captures.recordNote, 'u'),
  });
  expect(actions[0]).toBe(record);
  expect(record.textContent).toContain('3 of your drafts are waiting for review');
  fireEvent.click(record);
  expect(spies.start).toHaveBeenCalledTimes(1);
  expect(door.getAttribute('aria-expanded')).toBe('false');
});
it('CAPTURES-B17 the More dot shows only with Record in More and drafts waiting', () => {
  const dot = () => document.querySelector('[data-capture-dot]');
  spies.pending = 2;
  let view = moreNav('more');
  expect(dot()).not.toBeNull();
  expect(dot()?.textContent).toBe(en.captures.pendingDot);
  view.unmount();
  spies.pending = 0;
  view = moreNav('more');
  expect(dot()).toBeNull();
  expect(screen.getByRole('button', { name: en.common.navMore }).textContent).not.toContain('0');
  view.unmount();
  spies.pending = 2;
  moreNav('floating-end');
  expect(dot()).toBeNull();
  const door = screen.getByRole('button', { name: en.common.navMore });
  expect(door.hasAttribute('data-capture-opener')).toBe(false);
});
it('CAPTURES-B17 the pending line follows the Arabic plural forms', () => {
  spies.pending = 3;
  mount(<CaptureEntry.MoreAction />, 'ar');
  const record = screen.getByRole('button', { name: new RegExp(ar.captures.recordNote, 'u') });
  expect(record.textContent).toContain('3 مسودات لك بانتظار المراجعة');
  expect(record.querySelector('bdi')?.textContent).toBe('3');
});
const menu = (keys: 'Alt+V' | null, onOpenChange = vi.fn()) => {
  const record = captureEntries(setup({ desktop: 'account-menu', shortcut: keys !== null })).menu;
  mount(
    <Popover open onOpenChange={onOpenChange}>
      <AccountPanel
        user={{ name: 'Reader', email: 'reader@example.test', role: 'member' }}
        record={record}
        onDone={vi.fn()}
      />
    </Popover>,
  );
  return onOpenChange;
};
it('CAPTURES-B18 In the account menu Record is the top action, with the chord only while the shortcut is on', () => {
  spies.pending = 1;
  const onOpenChange = menu('Alt+V');
  const panel = screen.getByRole('dialog');
  const first = within(panel).getAllByRole('button')[0];
  expect(first?.textContent).toContain(en.captures.recordNote);
  expect(first?.textContent).toContain('1 of your drafts is waiting for review');
  expect(first?.classList.contains('max-lg:hidden')).toBe(true);
  expect(first?.getAttribute('aria-keyshortcuts')).toBe('Alt+V');
  expect(first?.querySelector('kbd')?.textContent).toBe(en.captures.shortcut);
  fireEvent.click(first as HTMLElement);
  expect(spies.start).toHaveBeenCalledTimes(1);
  // The menu closes on the same click that starts recording.
  expect(onOpenChange.mock.calls[0]?.[0]).toBe(false);
});
it('CAPTURES-B18 with the shortcut off the menu action names no chord, and with no drafts no count', () => {
  menu(null);
  const first = within(screen.getByRole('dialog')).getAllByRole('button')[0];
  expect(first?.getAttribute('aria-keyshortcuts')).toBeNull();
  expect(first?.querySelector('kbd')).toBeNull();
  expect(first?.textContent).toBe(en.captures.recordNote);
});
it('CAPTURES-B18 the header button is the computer’s only, with the chord while the shortcut is on', () => {
  let view = mount(<>{captureEntries(setup()).header}</>);
  const header = screen.getByRole('button', { name: new RegExp(en.captures.recordNote, 'u') });
  expect(header.className).toContain('hidden lg:inline-flex');
  expect(header.getAttribute('aria-keyshortcuts')).toBe('Alt+V');
  view.unmount();
  view = mount(<>{captureEntries(setup({ shortcut: false })).header}</>);
  expect(
    screen.getByRole('button', { name: en.captures.recordNote }).getAttribute('aria-keyshortcuts'),
  ).toBeNull();
});
