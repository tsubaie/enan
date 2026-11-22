'use client';
import { useRef, useState } from 'react';
// One review action at a time: while one is in flight a click is ignored (a ref as well as the
// state, so a second click in the same frame is ignored too) and its failure is kept to show.
export function useReviewAction<Kind extends string>() {
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState<Kind | null>(null);
  const inFlight = useRef(false);
  const run = (kind: Kind, action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setBusy(kind);
    action()
      .catch((failure: unknown) => setError(failure instanceof Error ? failure : null))
      .finally(() => {
        inFlight.current = false;
        setBusy(null);
      });
  };
  return { error, busy, run };
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
