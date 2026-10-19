// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useEntityController } from '../use-entity-controller';
import { testConfig } from './fixtures';
// EP-B30: every piece of this URL is client state, so it is written with the native history
// methods and never through the router — opening a record must not ask the server for the page
// again. EP-B02 rides on the same calls: open pushes, next/prev and filters replace, close pushes.
const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({
  usePathname: () => '/measures',
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => router,
}));
function controller() {
  return renderHook(() => useEntityController(testConfig(), { current: null })).result;
}
describe('entity history', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/measures?view=all');
    vi.spyOn(window.history, 'pushState');
    vi.spyOn(window.history, 'replaceState');
  });
  afterEach(() => vi.restoreAllMocks());
  it('EP-B30 EP-B02 opening a record pushes a native history entry and never routes', () => {
    const result = controller();
    act(() => result.current.navigate({ id: 'a' }));
    expect(window.history.pushState).toHaveBeenCalledWith(null, '', '/measures?view=all&id=a');
    expect(window.location.search).toBe('?view=all&id=a');
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });
  it('EP-B30 EP-B02 a filter change replaces the entry and drops the open record; close pushes', () => {
    const result = controller();
    act(() => result.current.navigate({ id: 'a' }));
    act(() => result.current.navigate({ view: 'stale' }, true));
    expect(window.history.replaceState).toHaveBeenLastCalledWith(null, '', '/measures?view=stale');
    act(() => result.current.navigate({ id: 'b' }));
    act(() => result.current.close());
    expect(window.history.pushState).toHaveBeenLastCalledWith(null, '', '/measures?view=stale');
    expect(window.location.search).toBe('?view=stale');
    expect(router.push).not.toHaveBeenCalled();
  });
  it('EP-B30 the state the hook reports is read back from the address it wrote', () => {
    const result = controller();
    act(() => result.current.navigate({ id: 'a', focus: 'name' }));
    const next = controller();
    expect(next.current.state.id).toBe('a');
    expect(next.current.state.focus).toBe('name');
    expect(next.current.state.view).toBe('all');
  });
});
