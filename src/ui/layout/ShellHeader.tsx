'use client';
import { Suspense, lazy, useEffect, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { closeSearchPalette, openSearchPalette, useSearchPalette } from './search-palette-store';
// The palette is a whole dialog, a query and a result list, and it is loaded by every route in the
// product for a control most visits never open. It arrives when it is first opened instead
// (the pattern ChoiceSelect already uses for its searchable variant).
const SearchPalette = lazy(() =>
  import('./SearchPalette').then((module) => ({ default: module.SearchPalette })),
);
import { AccountMenu } from './AccountMenu';
import { LanguageToggle } from './LanguageToggle';
import { HEADER_TITLE_SLOT } from './shell-slot';
import { NotificationBell } from '@/modules/notifications/ui';
// 05 § Layout shell: the header carries search, the language, notifications and the account. It
// used to carry the workspace name, which the sidebar foot already says in a heavier weight on the
// same screen. A band that spans every page at every width has to earn it; the language does,
// because a reader who landed in the wrong one cannot read the menu it used to hide in.
export function ShellHeader({ user }: { user: { name: string; email: string; role: string } }) {
  const t = useTranslations('common');
  const { open, query } = useSearchPalette();
  const apple = useApplePlatform();
  useSearchShortcut(openSearchPalette);
  return (
    <header className="flex min-h-14 shrink-0 items-center gap-2 border-b px-4 lg:px-6">
      {/* The page's title, at the header's leading edge from 1024 px, the way a macOS window titles
          its toolbar. A list page renders its title group here (EntityTitle); a page without one
          leaves it empty. */}
      <div id={HEADER_TITLE_SLOT} className="flex min-w-0 flex-1 items-center gap-2" />
      {/* SEARCH-B08: a button, not an input. The palette owns the text, so there is one place it is
          typed and no state to hand over when it opens.
          SEARCH-B11: and it looks like one. It used to be drawn as a bordered field stretched
          across the band, one row above the list's own search field, so every entity page showed
          two things to type into and the reader had to guess which one they meant. Only the list's
          field is somewhere to type; this is a launcher — an icon, the word and the key, at its
          natural width beside the other two utilities — and on a phone the icon alone. */}
      <div className="ms-auto flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          className="gap-2 font-normal text-text-muted"
          aria-label={t('searchWorkspace')}
          onClick={() => openSearchPalette()}
        >
          <Search aria-hidden={true} className="size-4" />
          <span className="hidden sm:inline">{t('searchOpen')}</span>
          <kbd
            translate="no"
            aria-hidden={true}
            className="hidden rounded border px-1.5 py-0.5 font-sans text-[11px] tabular-nums sm:inline"
          >
            {t(apple ? 'searchShortcutMac' : 'searchShortcut')}
          </kbd>
        </Button>
        {/* On a phone the language is chosen in the bar's More sheet (MobileNav), not up here. */}
        <div className="hidden lg:block">
          <LanguageToggle />
        </div>
        <NotificationBell />
        <AccountMenu user={user} />
      </div>
      {open && (
        <Suspense fallback={null}>
          <SearchPalette
            open={open}
            initialQuery={query}
            onOpenChange={(next) => {
              if (!next) closeSearchPalette();
            }}
          />
        </Suspense>
      )}
    </header>
  );
}
// SEARCH-B08: ⌘K on a Mac, Ctrl+K elsewhere. It is ignored while a field has focus for the same
// reason the entity framework's own shortcuts are (EP-B06), except that this one is a modifier
// chord and therefore cannot be typed by accident — so only a text field that would swallow it
// needs the guard.
function useSearchShortcut(open: () => void) {
  // The chord has to work wherever focus is, which is what a global palette shortcut means.
  // sync: external system — the document's key events.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'k' || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      open();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
}
// The hint names the key the reader actually presses. The user agent is an external store that
// never changes and has no value on the server, so it is read through the primitive that exists
// for exactly that (the same reasoning EP-B29 gives for the remembered layout) rather than
// corrected by an effect a frame after paint. Ctrl is the server's honest answer.
const subscribe = () => () => {};
const isApple = () => /mac|iphone|ipad/i.test(navigator.userAgent);
function useApplePlatform() {
  return useSyncExternalStore(subscribe, isApple, () => false);
}
