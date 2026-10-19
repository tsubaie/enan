// The shared component harness (tests/fixtures/mount.tsx), under the name the module's scenarios import.
export { mount } from '../../../../../tests/fixtures/mount';
// KPIS-B29: the charts read the reduced-motion preference, which jsdom does not provide. The
// scenarios render the marks at rest, so every figure is in place as soon as the chart mounts.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function')
  window.matchMedia = (query: string) =>
    ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) satisfies MediaQueryList;
