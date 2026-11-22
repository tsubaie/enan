'use client';
import { useSyncExternalStore } from 'react';
// Small client stores for the inbox: whether the reader has dismissed the S30 line (on this
// device, §9 decision 4), whether the desktop side panel is open, and whether the screen is wide
// enough for it. The server renders as if dismissed, closed and narrow, so nothing flashes.
const educationKey = 'enan.captures.education-dismissed';
const listeners = new Set<() => void>();
let panelOpen = false;
function notify() {
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}
function readDismissed() {
  try {
    return localStorage.getItem(educationKey) === '1';
  } catch {
    return true;
  }
}
export function useEducationDismissed() {
  return useSyncExternalStore(subscribe, readDismissed, () => true);
}
export function dismissEducation() {
  try {
    localStorage.setItem(educationKey, '1');
  } catch {
    // shortcut: a browser that refuses storage shows the line again next visit; nothing is lost.
  }
  notify();
}
export function setReviewPanel(open: boolean) {
  panelOpen = open;
  notify();
}
export function useReviewPanel() {
  return useSyncExternalStore(
    subscribe,
    () => panelOpen,
    () => false,
  );
}
const wide = '(min-width: 1024px)';
// Without matchMedia (an old browser, a test document) the layout is the desktop one.
const media = () => (typeof matchMedia === 'function' ? matchMedia(wide) : null);
export const isWideScreen = () => media()?.matches ?? true;
function subscribeWide(change: () => void) {
  const query = media();
  query?.addEventListener('change', change);
  return () => query?.removeEventListener('change', change);
}
// The desktop layout (side panel, inline drafts) against the phone's (compact cards, full screen).
export function useWideScreen() {
  return useSyncExternalStore(subscribeWide, isWideScreen, () => true);
}
