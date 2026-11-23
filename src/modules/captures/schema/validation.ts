import { z } from 'zod';
import { Priority } from '@/modules/tasks/schema/validation';
import { Tags } from '@/modules/notes/schema/validation';
import { DesktopPlacement, MobilePlacement } from '@/core/config/capture-placement';
// CAPTURES-I01: the lifecycle a recording moves through before anything goes live (ADR 0071).
// `needs_transcript` is a stored recording with no transcript yet (AI off, unconfigured, over
// budget); `failed` keeps the audio and any transcript for a retry. Deletion is `deleted_at`.
export const CaptureStatus = z.enum([
  'queued',
  'transcribing',
  'interpreting',
  'ready',
  'needs_transcript',
  'failed',
]);
export type CaptureStatus = z.infer<typeof CaptureStatus>;
export const SuggestionKind = z.enum(['task', 'meeting_note', 'committee_note']);
export type SuggestionKind = z.infer<typeof SuggestionKind>;
export const SuggestionStatus = z.enum(['pending', 'approved', 'discarded', 'merged']);
export type SuggestionStatus = z.infer<typeof SuggestionStatus>;
export const LiveEntityType = z.enum(['task', 'note']);
// CAPTURES-B09: how sure the interpreter is of one field, in words, never a percentage.
export const FieldState = z.enum(['confident', 'several', 'unknown']);
export type FieldState = z.infer<typeof FieldState>;
export const durationLimit = 900;
const Title = z.string().trim().min(1).max(500);
const Body = z.string().trim().min(1).max(50000);
const Ids = z
  .array(z.uuid())
  .max(50)
  .transform((values) => [...new Set(values)]);
const NoteType = z.string().trim().min(1).max(100);
// What each kind of draft carries. A required field may be null while it is unresolved; Approve
// refuses a draft until the reviewer settles it.
export const TaskPayload = z.strictObject({
  title: Title,
  ownerId: z.uuid().nullable().default(null),
  spokenOwner: z.string().trim().max(200).optional(),
  dueDate: z.iso.date().nullable().default(null),
  committeeId: z.uuid().nullable().default(null),
  description: z.string().max(50000).optional(),
  priority: Priority.nullable().default(null),
  status: z.literal('inbox').default('inbox'),
});
export const MeetingNotePayload = z.strictObject({
  title: Title,
  type: NoteType.nullable().default(null),
  noteDate: z.iso.date().nullable().default(null),
  body: Body,
  committeeId: z.uuid().nullable().default(null),
  participantIds: Ids.default([]),
  tags: Tags.default([]),
});
export const CommitteeNotePayload = z.strictObject({
  title: Title,
  committeeId: z.uuid().nullable().default(null),
  noteDate: z.iso.date().nullable().default(null),
  body: Body,
  type: NoteType.nullable().default(null),
  participantIds: Ids.default([]),
  tags: Tags.default([]),
});
export const FieldStateEntry = z.strictObject({
  state: FieldState,
  candidates: z.array(z.uuid()).max(20).default([]),
  sourceText: z.string().max(2000).optional(),
});
export const FieldStates = z.record(z.string().min(1).max(50), FieldStateEntry);
export type FieldStates = z.infer<typeof FieldStates>;
// Character offsets into the capture's transcript, for highlighting only (no audio seek).
export const SourceSpan = z
  .strictObject({ start: z.number().int().nonnegative(), end: z.number().int().positive() })
  .refine((span) => span.end > span.start, { message: 'end must follow start' });
export const SourceSpans = z.array(SourceSpan).max(50);
const suggestionOf = <K extends SuggestionKind, P extends z.ZodType>(kind: K, payload: P) =>
  z.strictObject({
    kind: z.literal(kind),
    payload,
    fieldStates: FieldStates.default({}),
    sourceSpans: SourceSpans.default([]),
    typeFlag: SuggestionKind.nullable().default(null),
  });
// The editable part of a suggestion, discriminated by kind so a payload always fits its kind.
export const SuggestionContent = z.discriminatedUnion('kind', [
  suggestionOf('task', TaskPayload),
  suggestionOf('meeting_note', MeetingNotePayload),
  suggestionOf('committee_note', CommitteeNotePayload),
]);
export type SuggestionContent = z.infer<typeof SuggestionContent>;
const timestamp = z.preprocess(
  (v) => (v instanceof Date ? v.toISOString() : v),
  z.iso.datetime({ offset: true }),
);
export const Capture = z.object({
  id: z.uuid(),
  revision: z.number().int(),
  fileId: z.uuid(),
  durationSeconds: z.number().int().min(0).max(durationLimit),
  transcript: z.string().nullable(),
  status: CaptureStatus,
  errorCode: z.string().nullable(),
  errorDetail: z.string().nullable(),
  contextCommitteeId: z.uuid().nullable(),
  contextNoteType: z.string().nullable(),
  transcribeJobId: z.uuid().nullable(),
  interpretJobId: z.uuid().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
  createdBy: z.uuid().nullable(),
  updatedBy: z.uuid().nullable(),
});
export type Capture = z.infer<typeof Capture>;
export const CaptureCount = z.object({ pending: z.number().int().nonnegative() });
// CAPTURES-B01 CAPTURES-B12: a recording or an uploaded file. The type is read from its bytes
// and its size capped at 25 MB by the shared voice audio check; the length is at most 15 minutes.
export const CaptureCreate = z.strictObject({
  file: z.file(),
  durationSeconds: z.coerce.number().int().min(0).max(durationLimit).default(0),
  transcript: z.string().trim().max(50000).optional(),
  committeeId: z.uuid().nullable().optional(),
  type: NoteType.nullable().optional(),
});
export const CaptureTranscript = z.strictObject({
  transcript: z.string().trim().min(1).max(50000),
});
// `all` is an administrator's view of everyone's drafts (CAPTURES-B02); for a member it is the
// member's own, as the visibility predicate allows nothing else.
export const CaptureScope = z.enum(['mine', 'all']);
export const CaptureListQuery = z.strictObject({
  scope: CaptureScope.default('mine'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const Suggestion = z.object({
  id: z.uuid(),
  revision: z.number().int(),
  captureId: z.uuid(),
  kind: SuggestionKind,
  payload: z.json(),
  fieldStates: FieldStates,
  sourceSpans: SourceSpans,
  typeFlag: SuggestionKind.nullable(),
  status: SuggestionStatus,
  liveEntityType: LiveEntityType.nullable(),
  liveEntityId: z.uuid().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type Suggestion = z.infer<typeof Suggestion>;
export const CaptureGroup = Capture.extend({
  audioUrl: z.string(),
  suggestions: z.array(Suggestion),
});
export type CaptureGroup = z.infer<typeof CaptureGroup>;
export const CaptureList = z.object({
  data: z.array(CaptureGroup),
  meta: z.object({
    nextCursor: z.string().nullable(),
    // CAPTURES-B22: `off` when the workspace has transcription switched off, so Retry and Type the
    // transcript wait for an administrator; `available` otherwise, even while the provider is down.
    transcription: z.enum(['off', 'available']),
  }),
});
// What each kind of draft must hold before Approve (§ Data model). Shared with the inbox, so the
// disabled Approve and the server's refusal give the same reason.
export const payloadSchemas = {
  task: TaskPayload,
  meeting_note: MeetingNotePayload,
  committee_note: CommitteeNotePayload,
};
export type RequiredField = 'title' | 'type' | 'committeeId' | 'noteDate' | 'body';
export const requiredFields: Record<SuggestionKind, readonly RequiredField[]> = {
  task: ['title'],
  meeting_note: ['title', 'type', 'noteDate', 'body'],
  committee_note: ['title', 'committeeId', 'noteDate', 'body'],
};
// A draft's payload as plain fields, for reading one field without knowing the kind yet.
export const PayloadFields = z.record(z.string(), z.json());
export type PayloadFields = z.infer<typeof PayloadFields>;
export const payloadFields = (payload: unknown) => PayloadFields.catch({}).parse(payload);
// CAPTURES-B10: the required fields still unsettled: empty, or one the interpreter was unsure of
// (`unknown`, or `several` without a choice). An optional field, such as an unmatched owner, and a
// type flag never block.
export function blockers(draft: Pick<Suggestion, 'kind' | 'payload' | 'fieldStates'>) {
  const payload = payloadFields(draft.payload);
  return requiredFields[draft.kind].filter((field) => {
    const value = payload[field] ?? '';
    const state = draft.fieldStates[field]?.state ?? 'confident';
    return value === '' || state !== 'confident';
  });
}
// A changed kind keeps the fields the kinds share; a task's description is a note's body and
// back. What the new kind requires and the old one lacked stays empty for the reviewer to fill.
export function reshape(kind: SuggestionKind, payload: PayloadFields): PayloadFields {
  const keys = Object.keys(payloadSchemas[kind].shape);
  const kept = Object.fromEntries(Object.entries(payload).filter(([key]) => keys.includes(key)));
  const text = payload.body ?? payload.description ?? null;
  if (kind !== 'task') return { ...kept, body: text ?? payload.title ?? null };
  return text === null ? kept : { ...kept, description: text };
}
const SuggestionRevisionValue = z.number().int().positive();
// An edit before Approve: the fields changed, and optionally a new kind (the type chip).
export const SuggestionPatch = z.strictObject({
  revision: SuggestionRevisionValue,
  kind: SuggestionKind.optional(),
  payload: z.record(z.string().min(1).max(50), z.json()).default({}),
});
export type SuggestionPatch = z.infer<typeof SuggestionPatch>;
export const SuggestionRevision = z.strictObject({ revision: SuggestionRevisionValue });
const SuggestionIds = z
  .array(z.uuid())
  .min(1)
  .max(100)
  .transform((values) => [...new Set(values)]);
// Without ids, every ready draft the reader recorded; with ids, exactly those, each one ready.
export const ApproveReady = z.strictObject({ ids: SuggestionIds.optional() });
export const UndoBatch = z.strictObject({ ids: SuggestionIds });
export const MergeSuggestions = z.strictObject({
  keepId: z.uuid(),
  mergeIds: SuggestionIds,
});
export const LiveRecord = z.object({ type: LiveEntityType, id: z.uuid() });
export const Approval = z.object({ suggestion: Suggestion, live: LiveRecord });
export type Approval = z.infer<typeof Approval>;
// CAPTURES-B14 CAPTURES-B15: how recording is set up for one reader, resolved on the server and
// handed to the shell and the inbox as props. `allowed` is the workspace switch; `enabled` is it
// and the reader's own; `shortcut` is Alt+V, only while recording is enabled.
export const CaptureSetup = z.object({
  enabled: z.boolean(),
  allowed: z.boolean(),
  shortcut: z.boolean(),
  // CAPTURES-B16: where the record control lives on a phone and on a computer.
  mobile: MobilePlacement,
  desktop: DesktopPlacement,
});
export type CaptureSetup = z.infer<typeof CaptureSetup>;
