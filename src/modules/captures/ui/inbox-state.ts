'use client';
import { createContext, use, useSyncExternalStore } from 'react';
import type { CaptureGroup } from '../schema/validation';
import type { CaptureScope } from './capture-queries';
import type { Layout } from './suggestion-card-context';
// The inbox as its parts read it. `saves` holds each draft's latest save (whether it succeeded), so
// Approve N ready can wait for an edit still being sent; `reread` reads the list again.
export type Inbox = {
  groups: CaptureGroup[];
  layout: Layout;
  scope: CaptureScope;
  saves: Map<string, Promise<boolean>>;
  reread: () => Promise<CaptureGroup[]>;
};
export const InboxContext = createContext<Inbox | null>(null);
export function useInbox() {
  const inbox = use(InboxContext);
  if (!inbox) throw new Error('CaptureInbox.Root is missing');
  return inbox;
}
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
// S17 Undo: the recording to focus once it is listed again. The restore answers before the list
// renders it, so Undo leaves its id here; the group takes it when it renders (CaptureGroup), and
// the inbox falls back to its heading when the list moves on without it (CaptureInbox.Root).
let pendingFocus: string | null = null;
export function focusWhenListed(captureId: string) {
  pendingFocus = captureId;
  notify();
}
export const pendingFocusId = () => pendingFocus;
// Clears the id if it is this one, and says whether it was.
export function takePendingFocus(captureId: string) {
  if (pendingFocus !== captureId) return false;
  pendingFocus = null;
  return true;
}
// Whether this recording is the one waiting for focus; only that group re-renders when it changes.
export function useFocusPending(captureId: string) {
  return useSyncExternalStore(
    subscribe,
    () => pendingFocus === captureId,
    () => false,
  );
}
export function usePendingFocus() {
  return useSyncExternalStore(subscribe, pendingFocusId, () => null);
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
