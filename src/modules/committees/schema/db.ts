import 'server-only';
import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { stamps } from '@/core/db/system-schema';
export const committees = sqliteTable(
  'committees',
  {
    id: text().primaryKey(),
    revision: integer().notNull().default(1),
    name: text().notNull(),
    description: text().notNull().default(''),
    ownership: text().notNull().default(''),
    scope: text().notNull().default('internal'),
    status: text().notNull().default('active'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...stamps(),
    // Search corpus written by the repo (ADR 0029): normalize(name) + '\n' + normalize(rest).
    searchText: text('search_text').notNull().default(''),
  },
  (t) => [
    uniqueIndex('committees_name_unique')
      .on(sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
    index('committees_creator_idx').on(t.createdBy),
    index('committees_updater_idx').on(t.updatedBy),
    index('committees_status_idx').on(t.status, t.deletedAt),
    check('committees_name_check', sql`length(trim(${t.name})) between 1 and 500`),
    check('committees_scope_check', sql`${t.scope} in ('internal','external')`),
    check('committees_status_check', sql`${t.status} in ('active','archived')`),
    check('committees_order_check', sql`${t.sortOrder} >= 0`),
  ],
);
