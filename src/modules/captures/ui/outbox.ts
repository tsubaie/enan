'use client';
import { useEffect, useSyncExternalStore } from 'react';
// CAPTURES-B20: the recordings this tab has stopped and not yet handed to the server. Each item
// holds its audio in memory only (never localStorage or IndexedDB) while it is uploading, after an
// upload that failed (until Retry or Discard), or refused (until Discard). Once the server has
// it (processing, or saved but unavailable) the item and its audio are dropped; the toast that
// says so is the after-Stop hook's business, not this store's. The server renders it empty.
export type OutboxState = 'uploading' | 'failed' | 'refused';
export type OutboxItem = {
  localId: string;
  file: File;
  seconds: number;
  committeeId: string | null;
  state: OutboxState;
};
let items: readonly OutboxItem[] = [];
const listeners = new Set<() => void>();
function write(next: readonly OutboxItem[]) {
  items = next;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export const outboxItem = (localId: string) => items.find((item) => item.localId === localId);
export function putItem(item: OutboxItem) {
  write([...items.filter((held) => held.localId !== item.localId), item]);
}
export function moveItem(localId: string, state: OutboxState) {
  write(items.map((item) => (item.localId === localId ? { ...item, state } : item)));
}
export function dropItem(localId: string) {
  write(items.filter((item) => item.localId !== localId));
}
// Whether leaving the page now would lose audio: one is still uploading, or failed and held.
const holding = () => items.some((item) => item.state === 'uploading' || item.state === 'failed');
// While a recording is still uploading, or failed and held for Retry, leaving the page would lose
// its audio, so the browser asks first (Q12). The shell's recorder host mounts it.
export function useLeaveWarning() {
  const held = useSyncExternalStore(subscribe, holding, () => false);
  // sync: external system — the browser's leave-page warning follows the outbox.
  useEffect(() => {
    if (!held) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [held]);
}
