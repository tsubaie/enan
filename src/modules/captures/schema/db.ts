import 'server-only';
import {
  sqliteTable,
  text,
  integer,
  index,
  check,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { committees } from '@/modules/committees/schema/db';
import { users, jobs, files, time, now, json, stamps } from '@/core/db/system-schema';
import type { FieldStates } from './validation';
// CAPTURES-I01: a recording waiting for review (ADR 0071). The audio is a `files` row written
// before this row (ADR 0054); deleting a capture soft-deletes it and keeps the binary (ADR 0034).
// Only the recorder and administrators may read one (CAPTURES-B02, `access.ts`).
export const captures = sqliteTable(
  'captures',
  {
    id: text().primaryKey(),
    revision: integer().notNull().default(1),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'restrict' }),
    durationSeconds: integer('duration_seconds').notNull().default(0),
    transcript: text(),
    status: text().notNull().default('queued'),
    errorCode: text('error_code'),
    errorDetail: text('error_detail'),
    contextCommitteeId: text('context_committee_id').references(() => committees.id, {
      onDelete: 'set null',
    }),
    contextNoteType: text('context_note_type'),
    transcribeJobId: text('transcribe_job_id').references(() => jobs.id, { onDelete: 'set null' }),
    interpretJobId: text('interpret_job_id').references(() => jobs.id, { onDelete: 'set null' }),
    ...stamps(),
  },
  (t) => [
    index('captures_creator_idx')
      .on(t.createdBy, t.createdAt)
      .where(sql`${t.deletedAt} is null`),
    index('captures_status_idx').on(t.status),
    index('captures_file_idx').on(t.fileId),
    index('captures_committee_idx').on(t.contextCommitteeId),
    index('captures_transcribe_job_idx').on(t.transcribeJobId),
    index('captures_interpret_job_idx').on(t.interpretJobId),
    index('captures_updater_idx').on(t.updatedBy),
    check('captures_duration_check', sql`${t.durationSeconds} between 0 and 900`),
    check(
      'captures_status_check',
      sql`${t.status} in ('queued', 'transcribing', 'interpreting', 'ready', 'needs_transcript', 'failed')`,
    ),
  ],
);
// A draft the interpreter proposed from one capture; nothing in it is live until Approve
// (CAPTURES-B03, CAPTURES-B10). `live_*` points at the task or note Approve created.
export const captureSuggestions = sqliteTable(
  'capture_suggestions',
  {
    id: text().primaryKey(),
    revision: integer().notNull().default(1),
    captureId: text('capture_id')
      .notNull()
      .references(() => captures.id, { onDelete: 'cascade' }),
    kind: text().notNull(),
    payload: json().notNull(),
    fieldStates: json('field_states').$type<FieldStates>().notNull().default({}),
    sourceSpans: json('source_spans')
      .$type<{ start: number; end: number }[]>()
      .notNull()
      .default([]),
    typeFlag: text('type_flag'),
    status: text().notNull().default('pending'),
    liveEntityType: text('live_entity_type'),
    liveEntityId: text('live_entity_id'),
    liveRevisionAtApprove: integer('live_revision_at_approve'),
    mergeTargetId: text('merge_target_id').references((): AnySQLiteColumn => captureSuggestions.id),
    approvedAt: time('approved_at'),
    approvedBy: text('approved_by').references(() => users.id),
    discardedAt: time('discarded_at'),
    createdAt: time('created_at').notNull().default(now),
    updatedAt: time('updated_at').notNull().default(now),
    createdBy: text('created_by').references(() => users.id),
    deletedAt: time('deleted_at'),
    deletedOpId: text('deleted_op_id'),
  },
  (t) => [
    index('capture_suggestions_capture_idx')
      .on(t.captureId, t.status)
      .where(sql`${t.deletedAt} is null`),
    index('capture_suggestions_live_idx').on(t.liveEntityId),
    index('capture_suggestions_merge_idx').on(t.mergeTargetId),
    index('capture_suggestions_approver_idx').on(t.approvedBy),
    index('capture_suggestions_creator_idx').on(t.createdBy),
    check(
      'capture_suggestions_kind_check',
      sql`${t.kind} in ('task', 'meeting_note', 'committee_note')`,
    ),
    check(
      'capture_suggestions_type_flag_check',
      sql`${t.typeFlag} in ('task', 'meeting_note', 'committee_note')`,
    ),
    check(
      'capture_suggestions_status_check',
      sql`${t.status} in ('pending', 'approved', 'discarded', 'merged')`,
    ),
    check('capture_suggestions_live_type_check', sql`${t.liveEntityType} in ('task', 'note')`),
  ],
);
