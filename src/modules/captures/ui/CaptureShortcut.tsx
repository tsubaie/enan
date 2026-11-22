'use client';
import { useEffect } from 'react';
import { startCapture } from './capture-store';
// Typing never starts a recording: a field, a select or editable text keeps its keys.
export function editable(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
// S9: Alt+V, Option+V on a Mac, registered once in the shell. A modifier chord, never a bare key
// (WCAG 2.1.4). `code` rather than `key`, because Option+V types "√" on a Mac keyboard.
export function CaptureShortcut() {
  // sync: external system — the document's key events.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.code !== 'KeyV' ||
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      if (editable(event.target)) return;
      event.preventDefault();
      startCapture();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return null;
}
