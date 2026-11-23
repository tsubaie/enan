'use client';
import { useRef, useState } from 'react';
import type { PayloadFields, SuggestionKind } from '../schema/validation';
// One review action at a time: while one is in flight a click is ignored (a ref as well as the
// state, so a second click in the same frame is ignored too) and its failure is kept to show.
// An action asked for while `waitFor` (a save) is in flight, another save included, is queued
// behind it and runs only once it has succeeded; `waiting` says so meanwhile. `run` answers
// whether the action succeeded, or null when it was ignored.
export function useReviewAction<Kind extends string>(waitFor?: Kind) {
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [waiting, setWaiting] = useState(false);
  const running = useRef<{ kind: Kind; done: Promise<boolean> } | null>(null);
  const run = (kind: Kind, action: () => Promise<void>): Promise<boolean> | null => {
    const ahead = running.current;
    if (ahead && ahead.kind !== waitFor) return null;
    setError(null);
    setBusy(kind);
    setWaiting(Boolean(ahead));
    // With nothing ahead the action starts now, in the click itself.
    const started = ahead
      ? ahead.done.then((saved) => {
          // An action queued behind this one keeps the line until it starts itself.
          if (running.current?.done === done) setWaiting(false);
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
// Edits waiting behind a save, as one: the latest value of each field and the latest kind win.
export type Change = { kind?: SuggestionKind; payload?: PayloadFields };
export function mergeChange(queued: Change | null, change: Change): Change {
  const kind = change.kind ?? queued?.kind;
  const payload = queued?.payload || change.payload;
  return {
    ...(kind && { kind }),
    ...(payload && { payload: { ...queued?.payload, ...change.payload } }),
  };
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
// WCAG 2.4.3: a deleted recording leaves the list, so focus goes to the next group's heading, else
// the inbox heading, never the page. Read before the delete, applied after the list has re-read.
export function focusAfterDeleting(captureId: string) {
  const group = listedGroup(captureId);
  const inbox = group?.closest('[data-inbox]');
  if (!group || !inbox) return () => {};
  const groups = [...inbox.querySelectorAll<HTMLElement>('[data-capture]')];
  const next = groups[groups.indexOf(group) + 1]?.querySelector<HTMLElement>('h3');
  const targets = [next, inbox.querySelector<HTMLElement>('h1')];
  return () => targets.find((target) => target?.isConnected)?.focus();
}
export const listedGroup = (captureId: string) =>
  document.querySelector<HTMLElement>(`[data-inbox] [data-capture="${captureId}"]`);
// The inbox heading: where focus goes when the thing it was on has gone and nothing replaces it.
export const focusInboxHeading = () =>
  document.querySelector<HTMLElement>('[data-inbox] h1')?.focus();
// The drafts whose latest save failed, once every save in flight has answered.
export async function failedSaves(saves: Map<string, Promise<boolean>>) {
  const ids = [...saves.keys()];
  const outcomes = await Promise.allSettled(saves.values());
  return new Set(
    ids.filter((_, at) => {
      const outcome = outcomes[at];
      return outcome?.status !== 'fulfilled' || !outcome.value;
    }),
  );
}
