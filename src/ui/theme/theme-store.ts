// ADR 0072: the theme lives in a small store, not in a context value. The context above the page
// hands every consumer the same store for the life of the page, so nothing a reader's device says
// can change a context value while a streamed page is still waiting to hydrate.
export type Theme = 'dark' | 'light';
export type ThemeStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => Theme;
  // The theme the server drew the page in, which is what every client render reads while hydrating.
  getServerSnapshot: () => Theme;
  set: (theme: Theme) => void;
};
const themes: readonly Theme[] = ['dark', 'light'];
// The same steps as the pre-paint script below, for a change made after the page is up.
function apply(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove(...themes);
  root.classList.add(theme);
  root.style.colorScheme = theme;
}
export function createThemeStore(initial: Theme): ThemeStore {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => current,
    getServerSnapshot: () => initial,
    // Draws the theme on the page every time, so the first call after mount also puts it there when
    // the page was rendered on the client; readers are told only when it changed.
    set: (theme) => {
      apply(theme);
      if (theme === current) return;
      current = theme;
      for (const listener of listeners) listener();
    },
  };
}
// Runs before the first paint, so the page is never drawn in the other theme. The theme is one of
// two fixed words, so it is written into the script as a JSON string literal.
export function themeScript(theme: Theme) {
  return `(function(t){var r=document.documentElement;r.classList.remove('dark','light');r.classList.add(t);r.style.colorScheme=t})(${JSON.stringify(theme)})`;
}
