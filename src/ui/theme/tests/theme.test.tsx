// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, memo } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { ThemeProvider, useTheme } from '@/ui/theme/ThemeProvider';
import { themeScript } from '@/ui/theme/theme-store';
// ADR 0072: what sits above a streamed page must not change while the page waits to hydrate. A
// reader below a memo boundary re-renders only when the theme context or its store tells it to,
// so counting its renders across hydration counts the changes the page would see.
const page = document.documentElement;
afterEach(() => {
  page.className = '';
  page.style.colorScheme = '';
  vi.unstubAllGlobals();
});
function systemScheme(scheme: 'dark' | 'light') {
  const query = vi.fn((media: string) => ({
    matches: media.includes(scheme),
    media,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
  vi.stubGlobal('matchMedia', query);
  return query;
}
function probe() {
  const seen: string[] = [];
  const controls: { set?: (theme: 'dark' | 'light') => void } = {};
  const Reader = memo(function Reader() {
    const { theme, setTheme } = useTheme();
    seen.push(theme);
    controls.set = setTheme;
    return <p data-theme-read={theme}>{theme}</p>;
  });
  return { seen, controls, Reader };
}
async function hydrate(node: () => React.ReactElement) {
  const container = document.createElement('div');
  container.innerHTML = renderToString(node());
  document.body.append(container);
  const recoverable = vi.fn();
  const root = await act(async () =>
    hydrateRoot(container, node(), { onRecoverableError: recoverable }),
  );
  return {
    container,
    recoverable,
    done: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}
for (const scheme of ['light', 'dark'] as const)
  it(`ACCT-B04 hydrating under a ${scheme} system changes nothing above the page: one render, the server's theme, no system query`, async () => {
    const query = systemScheme(scheme);
    const { seen, Reader } = probe();
    const app = () => (
      <ThemeProvider theme="dark">
        <Reader />
      </ThemeProvider>
    );
    const view = await hydrate(app);
    // The server render read the theme once; the client read it once more while hydrating.
    expect(seen).toEqual(['dark', 'dark']);
    expect(view.recoverable).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(page.classList.contains('dark')).toBe(true);
    expect(page.style.colorScheme).toBe('dark');
    view.done();
  });
it('ACCT-B04 a theme set after hydration reaches its readers and the page, and the context stays put', async () => {
  systemScheme('light');
  const { seen, controls, Reader } = probe();
  // A reader of the context alone: it renders again only if the context value changes.
  let contextRenders = 0;
  const Context = memo(function Context() {
    contextRenders += 1;
    return null;
  });
  const app = () => (
    <ThemeProvider theme="light">
      <Reader />
      <Context />
    </ThemeProvider>
  );
  const view = await hydrate(app);
  contextRenders = 0;
  seen.length = 0;
  act(() => controls.set?.('dark'));
  expect(seen).toEqual(['dark']);
  expect(view.container.querySelector('[data-theme-read]')?.textContent).toBe('dark');
  expect(page.classList.contains('dark')).toBe(true);
  expect(page.classList.contains('light')).toBe(false);
  expect(page.style.colorScheme).toBe('dark');
  // Setting the theme it already has tells nobody.
  act(() => controls.set?.('dark'));
  expect(seen).toEqual(['dark']);
  expect(contextRenders).toBe(0);
  view.done();
});
it('ACCT-B04 a provider inside another passes its children through, and the outer theme holds', async () => {
  const { seen, Reader } = probe();
  const app = () => (
    <ThemeProvider theme="light">
      <ThemeProvider theme="dark">
        <Reader />
      </ThemeProvider>
    </ThemeProvider>
  );
  const view = await hydrate(app);
  expect(seen.at(-1)).toBe('light');
  // One pre-paint script on the page: the outer provider's.
  expect(view.container.querySelectorAll('script')).toHaveLength(1);
  expect(page.classList.contains('light')).toBe(true);
  view.done();
});
it('ACCT-B04 the server writes the pre-paint script as it is, and it draws the theme before React runs', () => {
  const html = renderToString(
    <ThemeProvider theme="light" nonce="request-nonce">
      <p />
    </ThemeProvider>,
  );
  // The nonce is written only off the browser; this environment has a window, so it is not checked.
  const script = new DOMParser().parseFromString(html, 'text/html').querySelector('script');
  expect(script?.textContent).toBe(themeScript('light'));
  page.className = 'dark';
  new Function(script?.textContent ?? '')();
  expect(page.classList.contains('light')).toBe(true);
  expect(page.classList.contains('dark')).toBe(false);
  expect(page.style.colorScheme).toBe('light');
});
it('ACCT-B04 reading the theme outside its provider is a programming error', () => {
  const Reader = () => <p>{useTheme().theme}</p>;
  expect(() => renderToString(<Reader />)).toThrow(/outside ThemeProvider/u);
});
