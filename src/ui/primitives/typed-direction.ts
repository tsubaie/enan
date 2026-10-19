'use client';
import { useCallback, useLayoutEffect, useRef, type Ref } from 'react';
type TextField = HTMLInputElement | HTMLTextAreaElement;
// EP-B45: a text field runs in the direction of what is typed in it, Arabic right to left and
// English left to right, whatever the interface language. `dir="auto"` does that for text, but
// browsers resolve an empty field to left to right, which would put the caret of every empty field
// on the wrong side in Arabic; an empty field therefore carries no `dir` and follows the page.
// A caller that pins `dir` (a password, an English-only label) keeps it and nothing is tracked.
export function useTypedDirection<T extends TextField>(
  ref: Ref<T> | undefined,
  pinned: string | undefined,
) {
  const field = useRef<T | null>(null);
  // sync: a controlled value or a form reset changes the text without an input event.
  useLayoutEffect(() => {
    if (pinned === undefined) follow(field.current);
  });
  return useCallback(
    (element: T | null) => {
      field.current = element;
      const onInput = () => follow(element);
      if (element && pinned === undefined) {
        follow(element);
        element.addEventListener('input', onInput);
      }
      const detach = assignRef(ref, element);
      return () => {
        element?.removeEventListener('input', onInput);
        field.current = null;
        detach();
      };
    },
    [ref, pinned],
  );
}
function follow(element: TextField | null) {
  if (!element) return;
  if (element.value) element.dir = 'auto';
  else element.removeAttribute('dir');
}
function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') {
    const cleanup = ref(value);
    return typeof cleanup === 'function' ? cleanup : () => ref(null);
  }
  if (ref) {
    ref.current = value;
    return () => {
      ref.current = null;
    };
  }
  return () => undefined;
}
