import 'server-only';
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users, jobs, time, now, stamps, boolean, json } from '@/core/db/system-schema';
import { people } from '@/modules/people/schema/db';
// docs/03 § Numbers: KPI values and targets are REAL (an IEEE double), the same number the JSON
// boundary carries, so what a reading holds is exactly what the API returns.
const amount = (name: string) => real(name);
export const objectives = sqliteTable(
  'objectives',
  {
    id: text().primaryKey(),
    revision: integer().notNull().default(1),
    name: text().notNull(),
    description: text().notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    ...stamps(),
  },
  (t) => [
    index('objectives_order_idx').on(t.sortOrder, t.id),
    index('objectives_creator_idx').on(t.createdBy),
    index('objectives_updater_idx').on(t.updatedBy),
    check('objectives_name_check', sql`length(trim(${t.name})) between 1 and 500`),
    check('objectives_order_check', sql`${t.sortOrder} >= 0`),
  ],
);
export const kpis = sqliteTable(
  'kpis',
  {
    id: text().primaryKey(),
    revision: integer().notNull().default(1),
    name: text().notNull(),
    unit: text().notNull().default('count'),
    direction: text().notNull().default('higher'),
    frequency: text().notNull().default('quarterly'),
    category: text().notNull().default(''),
    objectiveId: text('objective_id').references(() => objectives.id, { onDelete: 'set null' }),
    ownerId: text('owner_id').references(() => people.id, { onDelete: 'set null' }),
    notes: text().notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    // KPIS-B30: whether the owner is reminded of a period that has no reading yet.
    remindersEnabled: boolean('reminders_enabled').notNull().default(true),
    ...stamps(),
    // Search corpus written by the repo (ADR 0029): normalize(name) + '\n' + normalize(rest).
    searchText: text('search_text').notNull().default(''),
  },
  (t) => [
    index('kpis_objective_idx').on(t.objectiveId),
    index('kpis_owner_idx').on(t.ownerId),
    index('kpis_creator_idx').on(t.createdBy),
    index('kpis_updater_idx').on(t.updatedBy),
    index('kpis_name_idx').on(sql`lower(${t.name})`, t.id),
    check('kpis_name_check', sql`length(trim(${t.name})) between 1 and 500`),
    check('kpis_direction_check', sql`${t.direction} in ('higher', 'lower')`),
    check('kpis_unit_check', sql`${t.unit} in ('count', 'percent', 'sar', 'usd', 'points')`),
    check('kpis_frequency_check', sql`${t.frequency} in ('monthly', 'quarterly', 'annual')`),
    check('kpis_order_check', sql`${t.sortOrder} >= 0`),
  ],
);
// KPIS-I01: one reading per KPI per date among the non-deleted rows. Readings carry `revision`
// because KPIS-B08 edits their note in place (docs/03 § Table classes).
export const kpiReadings = sqliteTable(
  'kpi_readings',
  {
    id: text().primaryKey(),
    revision: integer().notNull().default(1),
    kpiId: text('kpi_id')
      .notNull()
      .references(() => kpis.id, { onDelete: 'cascade' }),
    readingDate: text('reading_date').notNull(),
    value: amount('value').notNull(),
    note: text().notNull().default(''),
    ...stamps(),
  },
  (t) => [
    uniqueIndex('kpi_readings_date_unique')
      .on(t.kpiId, t.readingDate)
      .where(sql`${t.deletedAt} is null`),
    index('kpi_readings_kpi_idx').on(t.kpiId, t.readingDate),
    index('kpi_readings_creator_idx').on(t.createdBy),
    index('kpi_readings_updater_idx').on(t.updatedBy),
    check('kpi_readings_value_check', sql`abs(${t.value}) < 10000000000`),
  ],
);
// KPIS-I02: one target per (kpi, year, period). Zero and negative targets are allowed; the status
// rules in KPIS-B01 handle them.
export const kpiTargets = sqliteTable(
  'kpi_targets',
  {
    id: text().primaryKey(),
    kpiId: text('kpi_id')
      .notNull()
      .references(() => kpis.id, { onDelete: 'cascade' }),
    year: integer().notNull(),
    period: integer().notNull(),
    targetValue: amount('target_value').notNull(),
    createdAt: time('created_at').notNull().default(now),
    updatedAt: time('updated_at').notNull().default(now),
    createdBy: text('created_by').references(() => users.id),
    deletedAt: time('deleted_at'),
    deletedOpId: text('deleted_op_id'),
  },
  (t) => [
    uniqueIndex('kpi_targets_period_unique')
      .on(t.kpiId, t.year, t.period)
      .where(sql`${t.deletedAt} is null`),
    index('kpi_targets_kpi_idx').on(t.kpiId, t.year, t.period),
    index('kpi_targets_creator_idx').on(t.createdBy),
    check('kpi_targets_period_check', sql`${t.period} between 1 and 12`),
    check('kpi_targets_year_check', sql`${t.year} between 1900 and 2999`),
    check('kpi_targets_value_check', sql`abs(${t.targetValue}) < 10000000000`),
  ],
);
// KPIS-B32: an executive brief written over a scope of the scorecard — the whole of it, one
// objective or one KPI — in one language and against one comparison period. `data_hash` is the
// digest of the figures it was written from, so a brief whose figures have since moved reads as
// stale rather than as current.
export const kpiNarratives = sqliteTable(
  'kpi_narratives',
  {
    id: text().primaryKey(),
    objectiveId: text('objective_id').references(() => objectives.id, { onDelete: 'cascade' }),
    kpiId: text('kpi_id').references(() => kpis.id, { onDelete: 'cascade' }),
    locale: text().notNull(),
    periodMode: text('period_mode').notNull().default('current'),
    dataHash: text('data_hash').notNull(),
    jobId: text('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    status: text().notNull().default('generating'),
    headline: text(),
    bodyMarkdown: text('body_markdown'),
    highlightsJson: json('highlights_json'),
    error: text(),
    createdAt: time('created_at').notNull().default(now),
    updatedAt: time('updated_at').notNull().default(now),
    createdBy: text('created_by').references(() => users.id),
    deletedAt: time('deleted_at'),
    deletedOpId: text('deleted_op_id'),
  },
  (t) => [
    index('kpi_narratives_kpi_idx').on(t.kpiId, t.locale, t.createdAt),
    index('kpi_narratives_objective_idx').on(t.objectiveId),
    index('kpi_narratives_job_idx').on(t.jobId),
    index('kpi_narratives_creator_idx').on(t.createdBy),
    check('kpi_narratives_locale_check', sql`${t.locale} in ('en', 'ar')`),
    check('kpi_narratives_period_check', sql`${t.periodMode} in ('previous', 'current', 'next')`),
    check('kpi_narratives_status_check', sql`${t.status} in ('generating', 'ready', 'failed')`),
  ],
);
