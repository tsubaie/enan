import 'server-only';
import { z } from 'zod';
import {
  SuggestionContent,
  SuggestionKind,
  type FieldState,
  type SuggestionContent as Content,
} from '../schema/validation';
// What the interpreter is given: the transcript as data and the catalogue it may choose from.
export const InterpretInput = z.object({
  captureId: z.uuid(),
  transcriptHash: z.string(),
  transcript: z.string(),
  today: z.iso.date(),
  contextCommitteeId: z.uuid().nullable(),
  contextNoteType: z.string().nullable(),
  committees: z.array(z.object({ id: z.uuid(), name: z.string() })),
  people: z.array(z.object({ id: z.uuid(), name: z.string() })),
  noteTypes: z.array(z.string()),
});
export type InterpretInput = z.infer<typeof InterpretInput>;
// The model's answer, flat so a provider's structured output can hold it. Nothing here is trusted:
// `toSuggestions` keeps only what the catalogue and the transcript can vouch for.
export const InterpretOutput = z.object({
  suggestions: z
    .array(
      z.object({
        kind: SuggestionKind,
        title: z.string().max(500),
        body: z.string().max(50000).nullable(),
        ownerId: z.string().nullable(),
        spokenOwner: z.string().max(200).nullable(),
        committeeId: z.string().nullable(),
        dueDate: z.string().nullable(),
        noteType: z.string().nullable(),
        noteDate: z.string().nullable(),
        sourceText: z.string().max(2000).nullable(),
        typeFlag: SuggestionKind.nullable(),
      }),
    )
    .max(10),
});
type Proposed = z.infer<typeof InterpretOutput>['suggestions'][number];
const date = (value: string | null) =>
  value && z.iso.date().safeParse(value).success ? value : null;
const known = (ids: string[], value: string | null) =>
  value && ids.includes(value) ? value : null;
// §4.3: unknown owners and committees are dropped, never invented; a span is kept only where its
// sentence is really in the transcript; an unsure type stays unset and `unknown`. A draft that
// still does not fit its kind's contract is dropped whole.
export function toSuggestions(output: z.infer<typeof InterpretOutput>, input: InterpretInput) {
  const committees = input.committees.map((committee) => committee.id);
  const people = input.people.map((person) => person.id);
  return output.suggestions.flatMap((proposed) => {
    const parsed = SuggestionContent.safeParse(content(proposed, input, committees, people));
    return parsed.success ? [parsed.data] : [];
  });
}
const state = (
  value: string | null,
  sourceText?: string,
): { state: FieldState; candidates: string[]; sourceText?: string } => ({
  state: value === null ? 'unknown' : 'confident',
  candidates: [],
  ...(sourceText ? { sourceText } : {}),
});
// The sentence a draft came from, as offsets, only where it is really in the transcript.
function spans(proposed: Proposed, transcript: string) {
  const source = proposed.sourceText?.trim() ?? '';
  const start = source ? transcript.indexOf(source) : -1;
  return start >= 0 ? [{ start, end: start + source.length }] : [];
}
function content(
  proposed: Proposed,
  input: InterpretInput,
  committees: string[],
  people: string[],
): Content {
  const title = proposed.title.trim();
  const committeeId =
    known(committees, proposed.committeeId) ?? known(committees, input.contextCommitteeId);
  const base = {
    sourceSpans: spans(proposed, input.transcript),
    typeFlag: proposed.typeFlag === proposed.kind ? null : proposed.typeFlag,
  };
  if (proposed.kind === 'task') return task(proposed, people, title, committeeId, base);
  return note(proposed, input, title, committeeId, base);
}
function task(
  proposed: Proposed,
  people: string[],
  title: string,
  committeeId: string | null,
  base: Pick<Content, 'sourceSpans' | 'typeFlag'>,
): Content {
  const ownerId = known(people, proposed.ownerId);
  const spokenOwner = proposed.spokenOwner?.trim() || undefined;
  const description = proposed.body?.trim() || undefined;
  return {
    kind: 'task',
    payload: {
      title,
      ownerId,
      ...(spokenOwner && !ownerId ? { spokenOwner } : {}),
      dueDate: date(proposed.dueDate),
      committeeId,
      ...(description ? { description } : {}),
      priority: null,
      status: 'inbox',
    },
    fieldStates: ownerId || spokenOwner ? { ownerId: state(ownerId, spokenOwner) } : {},
    ...base,
  };
}
// A meeting note's type and a committee note's committee are required; an unsure one stays unset
// and `unknown`, for the reviewer to settle before Approve (§9 decision 12).
function note(
  proposed: Proposed,
  input: InterpretInput,
  title: string,
  committeeId: string | null,
  base: Pick<Content, 'sourceSpans' | 'typeFlag'>,
): Content {
  const type =
    known(input.noteTypes, proposed.noteType) ?? known(input.noteTypes, input.contextNoteType);
  const noteDate = date(proposed.noteDate) ?? input.today;
  const body = proposed.body?.trim() || proposed.sourceText?.trim() || title;
  const fields = { title, noteDate, body, committeeId, type, participantIds: [], tags: [] };
  if (proposed.kind === 'meeting_note')
    return {
      kind: 'meeting_note',
      payload: fields,
      fieldStates: { noteDate: state(noteDate), type: state(type) },
      ...base,
    };
  return {
    kind: 'committee_note',
    payload: fields,
    fieldStates: { noteDate: state(noteDate), committeeId: state(committeeId) },
    ...base,
  };
}
