// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { HydrationMark } from '@/ui/layout/HydrationMark';
const route = vi.hoisted(() => ({ pathname: '/home' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
afterEach(cleanup);
const ready = () => document.documentElement.dataset.hydrated;
it('ADR 0072 the page is marked ready only once both its own boundary and the shell have mounted', () => {
  const shell = render(<HydrationMark part="shell" />);
  expect(ready()).toBeUndefined();
  const page = render(<HydrationMark part="page" />);
  expect(ready()).toBe('1');
  page.unmount();
  expect(ready()).toBeUndefined();
  shell.unmount();
});
it('ADR 0072 a route change takes the mark down and puts it back once the next page has mounted', () => {
  const shell = render(<HydrationMark part="shell" />);
  const page = render(<HydrationMark part="page" />);
  const watch = new MutationObserver(() => {});
  watch.observe(document.documentElement, {
    attributeFilter: ['data-hydrated'],
    attributeOldValue: true,
  });
  route.pathname = '/tasks';
  page.rerender(<HydrationMark part="page" />);
  // Each record holds the value it replaced: first the mark is taken down, then set again.
  expect(watch.takeRecords().map((record) => record.oldValue)).toEqual(['1', null]);
  expect(ready()).toBe('1');
  watch.disconnect();
  page.unmount();
  shell.unmount();
  route.pathname = '/home';
});
