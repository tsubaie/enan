'use client';
import { useEffect, type RefObject } from 'react';
// Below 1024 px a record is a sheet risen from the bottom (tokens.css), and it goes back down the
// way iOS sheets do: pulled with a finger once its content is scrolled to the top, or sent down by
// a tap on the dimmed page or its close button. A pull past a fifth of the screen, or a flick,
// dismisses it; less springs back.
const PHONE = '(max-width: 1023.98px)';
const DISMISS_SHARE = 0.2;
const FLICK = 0.6; // px per ms
const EXIT_MS = 220;
function settle(sheet: HTMLElement, to: string, done?: () => void) {
  sheet.style.transition = `translate ${EXIT_MS}ms var(--ease-rise)`;
  sheet.style.translate = to;
  window.setTimeout(() => {
    sheet.style.transition = '';
    done?.();
  }, EXIT_MS);
}
// Sends the sheet down, then closes. A guard that keeps the record open (unsaved changes) leaves
// the sheet mounted, so it comes back up.
function send(sheet: HTMLElement | null, close: () => void) {
  if (!sheet || !window.matchMedia(PHONE).matches) return close();
  settle(sheet, '0 100%', () => {
    close();
    window.setTimeout(() => {
      if (sheet.isConnected) settle(sheet, '');
    }, 0);
  });
}
// Native listeners: a pull has to cancel the scroll it would otherwise start, and React's touch
// handlers are passive. Returns the cleanup.
function follow(sheet: HTMLElement, dismiss: () => void) {
  let start: { y: number; at: number } | null = null;
  let pulled = 0;
  const down = (event: TouchEvent) => {
    const touch = event.touches[0];
    const phone = window.matchMedia(PHONE).matches;
    start = touch && phone ? { y: touch.clientY, at: event.timeStamp } : null;
    pulled = 0;
  };
  const move = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (!start || !touch) return;
    const delta = touch.clientY - start.y;
    // Only a downward pull from the top of the content moves the sheet; anything else scrolls.
    if (pulled === 0 && (delta <= 0 || sheet.scrollTop > 0)) {
      start = null;
      return;
    }
    event.preventDefault();
    pulled = Math.max(0, delta);
    sheet.style.transition = 'none';
    sheet.style.translate = `0 ${pulled}px`;
  };
  const up = (event: TouchEvent) => {
    if (!start || pulled === 0) return;
    const speed = pulled / Math.max(1, event.timeStamp - start.at);
    start = null;
    if (pulled > window.innerHeight * DISMISS_SHARE || speed > FLICK) dismiss();
    else settle(sheet, '');
  };
  sheet.addEventListener('touchstart', down, { passive: true });
  sheet.addEventListener('touchmove', move, { passive: false });
  sheet.addEventListener('touchend', up);
  sheet.addEventListener('touchcancel', up);
  return () => {
    sheet.removeEventListener('touchstart', down);
    sheet.removeEventListener('touchmove', move);
    sheet.removeEventListener('touchend', up);
    sheet.removeEventListener('touchcancel', up);
  };
}
export function useSheetDismiss(
  sheet: RefObject<HTMLElement | null>,
  open: boolean,
  close: () => void,
) {
  const dismiss = () => send(sheet.current, close);
  // sync: the browser's touch stream on the open sheet.
  useEffect(() => {
    const element = sheet.current;
    if (!open || !element) return;
    return follow(element, () => send(element, close));
  }, [sheet, open, close]);
  return dismiss;
}
