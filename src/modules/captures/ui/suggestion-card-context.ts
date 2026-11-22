'use client';
import { createContext, use } from 'react';
import type { CaptureGroup, RequiredField, Suggestion, SuggestionKind } from '../schema/validation';
import type { Edit } from './SuggestionFields';
// S18–S22: one draft. `layout` is explicit: `compact` on a phone's list (Edit opens the draft full
// screen), `panel` inline in the desktop inbox, `screen` the phone's full-screen draft.
export type Layout = 'compact' | 'panel' | 'screen';
export type Busy = 'approve' | 'discard' | 'save';
export type Card = {
  draft: Suggestion;
  group: CaptureGroup;
  layout: Layout;
  missing: RequiredField[];
  editing: boolean;
  setEditing: (editing: boolean) => void;
  edit: Edit;
  changeKind: (kind: SuggestionKind) => void;
  error: Error | null;
  busy: Busy | null;
  // An action is queued behind a save still being sent.
  waiting: boolean;
  // Approve and Discard take the draft out of the list; focus moves on once it is gone. The
  // action is handed the draft as last saved.
  leave: (kind: Busy, action: (draft: Suggestion) => Promise<void>) => void;
};
export const CardContext = createContext<Card | null>(null);
export function useCard() {
  const card = use(CardContext);
  if (!card) throw new Error('SuggestionCard.Root is missing');
  return card;
}
