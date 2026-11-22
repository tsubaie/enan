'use client';
import { useRef, useState } from 'react';
// One review action at a time: while one is in flight a click is ignored (a ref as well as the
// state, so a second click in the same frame is ignored too) and its failure is kept to show.
// An action asked for while `waitFor` (a save) is in flight is queued behind it and runs only once
// it has succeeded; `waiting` says so meanwhile. `run` answers whether the action succeeded, or
// null when it was ignored.
export function useReviewAction<Kind extends string>(waitFor?: Kind) {
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [waiting, setWaiting] = useState(false);
  const running = useRef<{ kind: Kind; done: Promise<boolean> } | null>(null);
  const run = (kind: Kind, action: () => Promise<void>): Promise<boolean> | null => {
    const ahead = running.current;
    if (ahead && (ahead.kind !== waitFor || kind === waitFor)) return null;
    setError(null);
    setBusy(kind);
    setWaiting(Boolean(ahead));
    // With nothing ahead the action starts now, in the click itself.
    const started = ahead
      ? ahead.done.then((saved) => {
          setWaiting(false);
          return saved && action().then(() => true);
        })
      : action().then(() => true);
    const done: Promise<boolean> = started
      .catch((failure: unknown) => {
        setError(failure instanceof Error ? failure : null);
        return false;
      })
      .finally(() => {
        if (running.current?.done !== done) return;
        running.current = null;
        setBusy(null);
      });
    running.current = { kind, done };
    return done;
  };
  return { error, busy, waiting, run };
}
// WCAG 2.4.3: a reviewed draft leaves the list, so focus goes to the next draft, else the previous,
// else the inbox heading. Read before the action runs, applied after the list has re-read.
export function focusAfterLeaving(card: HTMLElement | null, draftId: string) {
  // The phone's full-screen draft is a portal; its place in the list is the listed card.
  const listed = card?.closest('[data-inbox]') ? card : listedDraft(draftId);
  const inbox = listed?.closest('[data-inbox]');
  if (!listed || !inbox) return () => {};
  const cards = [...inbox.querySelectorAll<HTMLElement>('[data-draft]')];
  const at = cards.indexOf(listed);
  const targets = [cards[at + 1], cards[at - 1], inbox.querySelector<HTMLElement>('h1')];
  return () => targets.find((target) => target?.isConnected)?.focus();
}
export const listedDraft = (draftId: string) =>
  document.querySelector<HTMLElement>(`[data-inbox] [data-draft="${draftId}"]`);
