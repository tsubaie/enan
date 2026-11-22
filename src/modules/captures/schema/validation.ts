import { z } from 'zod';
import { Priority } from '@/modules/tasks/schema/validation';
import { Tags } from '@/modules/notes/schema/validation';
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
