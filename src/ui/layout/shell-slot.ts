'use client';
import { useSyncExternalStore } from 'react';
// A place the shell leaves for a page to fill: the page renders into it through a portal. The shell
// draws the slot in the same commit that mounts a page reached by client navigation, so a page
// watches for it to appear rather than reading it once.
export const HEADER_TITLE_SLOT = 'shell-header-title';
function subscribe(notify: () => void) {
  const observer = new MutationObserver(notify);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}
export function useShellSlot(id: string) {
  return useSyncExternalStore(
    subscribe,
    () => document.getElementById(id),
    () => null,
  );
}
