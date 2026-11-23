'use client';
import { useEffect } from 'react';
import { startCapture } from './capture-store';
// CAPTURES-B19: the chord a control advertises, or null while the shortcut is off, when no control
// may name it (no `aria-keyshortcuts`, no keycap).
export type ShortcutKeys = 'Alt+V' | null;
// Typing never starts a recording: a field, a select or editable text keeps its keys.
export function editable(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
// CAPTURES-B19: the chord alone, once per press, outside text entry and IME composition.
function chord(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229 || event.repeat) return false;
  if (event.code !== 'KeyV' || !event.altKey) return false;
  return !event.ctrlKey && !event.metaKey && !event.shiftKey && !editable(event.target);
}
// S9: Alt+V, Option+V on a Mac, registered once in the shell, and only while the shortcut is on.
// A modifier chord, never a bare key (WCAG 2.1.4). `code` rather than `key`, because Option+V
// types "√" on a Mac and an Arabic layout types «ر»; Windows AltGr arrives as Ctrl+Alt and is left
// alone. preventDefault keeps Firefox's View menu (Alt+V on Windows and Linux) from opening.
export function CaptureShortcut() {
  // sync: external system — the document's key events.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!chord(event)) return;
      event.preventDefault();
      startCapture();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return null;
}
