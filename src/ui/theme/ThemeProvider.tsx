'use client';
import {
  createContext,
  use,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createThemeStore, themeScript, type Theme, type ThemeStore } from './theme-store';
// ADR 0072: no context value above a streamed Suspense boundary may change before hydration
// finishes; when one does, React renders that boundary again on the client and can leave the
// server's copy parked in the document. So this value is the store and its setter, made once:
// it never carries the theme itself, and nothing reads the system's colour scheme. Consumers read
// the theme from the store, whose server snapshot is the theme the server drew.
type ThemeContextValue = { store: ThemeStore; setTheme: (theme: Theme) => void };
const ThemeContext = createContext<ThemeContextValue | null>(null);
type Props = {
  // ACCT-B04: the reader's saved theme, read on the server for every page.
  theme: Theme;
  nonce?: string | undefined;
  children: ReactNode;
};
// The root layout's provider owns the theme. The (app) layout's Providers sits inside it and has no
// theme of its own to give, so a provider inside another one passes its children through.
export function ThemeProvider(props: Props) {
  return use(ThemeContext) ? props.children : <ThemeRoot {...props} />;
}
function ThemeRoot({ theme, nonce, children }: Props) {
  const [value] = useState<ThemeContextValue>(() => {
    const store = createThemeStore(theme);
    return { store, setTheme: store.set };
  });
  // After commit, and again when a later server render (a refresh after a save) brings another
  // saved theme, the store draws it and tells its readers; the context value stays the same object.
  // sync: the theme's class and colour scheme on <html>.
  useEffect(() => {
    value.store.set(theme);
  }, [value, theme]);
  return (
    <ThemeContext value={value}>
      <script
        // The browser hides a nonce from the DOM once the script has run, so the client renders
        // none and the difference is expected.
        nonce={typeof window === 'undefined' ? nonce : ''}
        suppressHydrationWarning
      >
        {themeScript(theme)}
      </script>
      {children}
    </ThemeContext>
  );
}
export function useTheme() {
  const value = use(ThemeContext);
  if (!value) throw new Error('useTheme is used outside ThemeProvider');
  const theme = useSyncExternalStore(
    value.store.subscribe,
    value.store.getSnapshot,
    value.store.getServerSnapshot,
  );
  return { theme, setTheme: value.setTheme };
}
