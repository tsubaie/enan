import 'server-only';
import {
  sqliteTable,
  text,
  integer,
  index,
  check,
  primaryKey,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { committees } from '@/modules/committees/schema/db';
import { users, time, now, stamps } from '@/core/db/system-schema';
import { people } from '@/modules/people/schema/db';
import { notes } from '@/modules/notes/schema/db';
export const tasks = sqliteTable(
  'tasks',
  {
    id: text().primaryKey(),
    revision: integer().notNull().default(1),
    committeeId: text('committee_id').references(() => committees.id, { onDelete: 'set null' }),
    title: text().notNull(),
    description: text(),
    status: text().notNull().default('inbox'),
    priority: text(),
    dueDate: text('due_date'),
    completedAt: time('completed_at'),
    ownerId: text('owner_id').references(() => people.id, { onDelete: 'set null' }),
    parentId: text('parent_id').references((): AnySQLiteColumn => tasks.id, {
      onDelete: 'set null',
    }),
    sourceNoteId: text('source_note_id').references(() => notes.id, { onDelete: 'set null' }),
    sortOrder: integer('sort_order').notNull(),
    ...stamps(),
    // Search corpus written by the repo (ADR 0029): normalize(title) + '\n' + normalize(description).
    searchText: text('search_text').notNull().default(''),
  },
  (t) => [
    index('tasks_committee_idx').on(t.committeeId),
    index('tasks_owner_idx').on(t.ownerId),
    index('tasks_parent_idx').on(t.parentId),
    index('tasks_source_note_idx').on(t.sourceNoteId),
    index('tasks_creator_idx').on(t.createdBy),
    index('tasks_updater_idx').on(t.updatedBy),
    index('tasks_due_idx').on(t.dueDate, t.id),
    index('tasks_status_idx').on(t.status, t.deletedAt),
    // `tasks_active_order_idx` (unique on coalesce(parent_id, ''), sort_order among live rows)
    // and the TASKS-I01 depth trigger are hand-written in drizzle/0000_initial.sql and declared
    // in custom-objects.json: drizzle-kit's SQLite generator splits an index expression on its
    // comma, and triggers are never generated.
    check('tasks_title_check', sql`length(trim(${t.title})) between 1 and 500`),
    check(
      'tasks_status_check',
      sql`${t.status} in ('inbox','next_action','waiting_on','someday','completed')`,
    ),
    check('tasks_priority_check', sql`${t.priority} in ('low','medium','high','urgent')`),
    check(
      'tasks_completed_check',
      sql`(${t.status} = 'completed') = (${t.completedAt} is not null)`,
    ),
    check('tasks_self_check', sql`${t.parentId} <> ${t.id}`),
  ],
);

// TASKS-B02: completing a parent with open subtasks changes several rows at once, so a completion
// is recorded as one operation with one identity. Undo needs each row's state from before, which
// nothing else stores: the audit log holds the patch that was applied, not what it replaced, and it
// is write-only infrastructure with untyped JSON rather than a place to read domain state back out
// of. Two small typed tables make ownership, idempotency and concurrency explicit instead.
export const taskCompletions = sqliteTable(
  'task_completions',
  {
    id: text().primaryKey(),
    rootTaskId: text('root_task_id')
      .notNull()
      .references((): AnySQLiteColumn => tasks.id, { onDelete: 'cascade' }),
    actorId: text('actor_id').references(() => users.id),
    status: text().notNull().default('completed'),
    createdAt: time('created_at').notNull().default(now),
    undoneAt: time('undone_at'),
  },
  (t) => [
    index('task_completions_root_idx').on(t.rootTaskId),
    index('task_completions_actor_idx').on(t.actorId),
    check('task_completions_status_check', sql`${t.status} in ('completed','undone')`),
    check(
      'task_completions_undone_check',
      sql`(${t.status} = 'undone') = (${t.undoneAt} is not null)`,
    ),
  ],
);
// One row per task the operation actually changed. A subtask that was already completed is not an
// item, so Undo leaves it completed. `completed_revision` is the revision the row carried once this
// operation had completed it, and it is the per-row fence Undo checks: if anything has touched the
// row since, the operation is refused rather than overwriting later work.
export const taskCompletionItems = sqliteTable(
  'task_completion_items',
  {
    completionId: text('completion_id')
      .notNull()
      .references(() => taskCompletions.id, { onDelete: 'cascade' }),
    taskId: text('task_id')
      .notNull()
      .references((): AnySQLiteColumn => tasks.id, { onDelete: 'cascade' }),
    previousStatus: text('previous_status').notNull(),
    previousCompletedAt: time('previous_completed_at'),
    completedRevision: integer('completed_revision').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.completionId, t.taskId] }),
    index('task_completion_items_task_idx').on(t.taskId),
    check(
      'task_completion_items_status_check',
      sql`${t.previousStatus} in ('inbox','next_action','waiting_on','someday','completed')`,
    ),
  ],
);
