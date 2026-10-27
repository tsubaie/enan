import 'server-only';
import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { committees } from '@/modules/committees/schema/db';
import { users, jobs, files, time, now, json, stamps } from '@/core/db/system-schema';
import { people } from '@/modules/people/schema/db';
export const notes = sqliteTable(
  'notes',
  {
    id: text().primaryKey(),
    revision: integer().notNull().default(1),
    committeeId: text('committee_id').references(() => committees.id, { onDelete: 'set null' }),
    title: text().notNull(),
    content: text().notNull().default(''),
    type: text(),
    noteDate: text('note_date').notNull(),
    tags: json().$type<string[]>().notNull().default([]),
    archivedAt: time('archived_at'),
    ...stamps(),
    // Search corpus written by the repo (ADR 0029): normalize(title) + '\n' + normalize(content).
    searchText: text('search_text').notNull().default(''),
  },
  (t) => [
    index('notes_committee_idx').on(t.committeeId),
    index('notes_date_idx')
      .on(t.noteDate, t.createdAt, t.id)
      .where(sql`${t.deletedAt} is null`),
    index('notes_type_idx').on(t.type),
    index('notes_archived_idx').on(t.archivedAt),
    index('notes_creator_idx').on(t.createdBy),
    index('notes_updater_idx').on(t.updatedBy),
    check('notes_title_check', sql`length(trim(${t.title})) between 1 and 500`),
    check('notes_tags_check', sql`json_array_length(${t.tags}) <= 10`),
  ],
);
// Participants (NOTES-I04): soft-deleted on removal so the audit trail keeps who was involved.
export const notePeople = sqliteTable(
  'note_people',
  {
    id: text().primaryKey(),
    noteId: text('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    personId: text('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'restrict' }),
    createdAt: time('created_at').notNull().default(now),
    createdBy: text('created_by').references(() => users.id),
    deletedAt: time('deleted_at'),
    deletedOpId: text('deleted_op_id'),
  },
  (t) => [
    uniqueIndex('note_people_active_idx')
      .on(t.noteId, t.personId)
      .where(sql`${t.deletedAt} is null`),
    index('note_people_note_idx').on(t.noteId),
    index('note_people_person_idx').on(t.personId),
    index('note_people_creator_idx').on(t.createdBy),
  ],
);

export const noteRefinements = sqliteTable(
  'note_refinements',
  {
    id: text().primaryKey(),
    noteId: text('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id),
    noteRevision: integer('note_revision').notNull(),
    contentHash: text('content_hash').notNull(),
    capabilityVersion: integer('capability_version').notNull(),
    refinedContent: text('refined_content').notNull(),
    suggestedTasks: json('suggested_tasks').notNull(),
    suggestedTags: json('suggested_tags').$type<string[]>().notNull(),
    summaryOfChanges: text('summary_of_changes').notNull(),
    status: text().notNull(),
    appliedTaskIds: json('applied_task_ids').$type<string[]>().notNull().default([]),
    reviewedAt: time('reviewed_at'),
    reviewedBy: text('reviewed_by').references(() => users.id),
    createdAt: time('created_at').notNull().default(now),
    updatedAt: time('updated_at').notNull().default(now),
    createdBy: text('created_by').references(() => users.id),
    deletedAt: time('deleted_at'),
    deletedOpId: text('deleted_op_id'),
  },
  (t) => [
    uniqueIndex('note_refinements_pending_idx')
      .on(t.noteId)
      .where(sql`${t.status} = 'pending'`),
    uniqueIndex('note_refinements_job_idx').on(t.jobId),
    index('note_refinements_note_idx').on(t.noteId),
    index('note_refinements_creator_idx').on(t.createdBy),
    index('note_refinements_reviewer_idx').on(t.reviewedBy),
    check(
      'note_refinements_status_check',
      sql`${t.status} in ('pending', 'applied', 'discarded', 'stale')`,
    ),
  ],
);
// NOTES-I08: a voice memo on a note. The audio is a content-addressed `files` row written before
// the row (ADR 0054); removing a memo soft-deletes it and keeps the binary (ADR 0034).
export const noteVoiceMemos = sqliteTable(
  'note_voice_memos',
  {
    id: text().primaryKey(),
    noteId: text('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'restrict' }),
    durationSeconds: integer('duration_seconds').notNull().default(0),
    transcript: text(),
    transcriptionStatus: text('transcription_status').notNull().default('pending'),
    transcriptionJobId: text('transcription_job_id').references(() => jobs.id, {
      onDelete: 'set null',
    }),
    transcriptionError: text('transcription_error'),
    createdAt: time('created_at').notNull().default(now),
    updatedAt: time('updated_at').notNull().default(now),
    createdBy: text('created_by').references(() => users.id),
    deletedAt: time('deleted_at'),
    deletedOpId: text('deleted_op_id'),
  },
  (t) => [
    index('note_voice_memos_note_idx').on(t.noteId, t.createdAt),
    index('note_voice_memos_file_idx').on(t.fileId),
    index('note_voice_memos_job_idx').on(t.transcriptionJobId),
    index('note_voice_memos_creator_idx').on(t.createdBy),
    check('note_voice_memos_duration_check', sql`${t.durationSeconds} between 0 and 900`),
    check(
      'note_voice_memos_status_check',
      sql`${t.transcriptionStatus} in ('pending', 'done', 'failed', 'skipped')`,
    ),
  ],
);
