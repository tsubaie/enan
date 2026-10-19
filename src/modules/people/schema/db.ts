import 'server-only';
import { sqliteTable, text, integer, index, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users, json, boolean, stamps } from '@/core/db/system-schema';
export const people = sqliteTable(
  'people',
  {
    id: text().primaryKey(),
    revision: integer().notNull().default(1),
    fullName: text('full_name').notNull(),
    displayName: text('display_name'),
    honorific: text(),
    organization: text(),
    roleTitle: text('role_title'),
    kind: text().notNull().default('external'),
    email: text(),
    phone: text(),
    notes: text(),
    tags: json().$type<string[]>().notNull().default([]),
    isAssignable: boolean('is_assignable').notNull().default(false),
    userId: text('user_id')
      .unique()
      .references(() => users.id, { onDelete: 'set null' }),
    ...stamps(),
    // ADR 0021 / ADR 0029: the search corpus, written by the repo on every insert and update
    // with `normalize()` from core/search (SQLite has no application functions for a generated
    // column). `normalize(fullName) + '\n' + normalize(rest)` so a prefix of it is a name prefix.
    searchText: text('search_text').notNull().default(''),
  },
  (t) => [
    index('people_name_idx').on(sql`lower(${t.fullName})`, t.id),
    index('people_creator_idx').on(t.createdBy),
    index('people_updater_idx').on(t.updatedBy),
    check('people_kind_check', sql`${t.kind} in ('internal', 'external')`),
    check('people_full_name_check', sql`length(trim(${t.fullName})) > 0`),
  ],
);
