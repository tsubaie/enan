import 'server-only';
// System schema on SQLite (ADR 0029). Column classes follow docs/03 § Types: ids are uuid v7 in
// text columns, timestamps are integer epoch milliseconds, booleans are 0/1 integers, JSON and
// arrays are JSON text. Every CHECK the PostgreSQL migrations carried is declared here so the
// schema audit can compare the declaration against the live file.
import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
  primaryKey,
  check,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const time = (name: string) => integer(name, { mode: 'timestamp_ms' });
// The one `now()` used everywhere: statement time in epoch milliseconds, as an integer.
export const now = sql`(cast(unixepoch('subsec') * 1000 as integer))`;
export const json = (name?: string) =>
  name ? text(name, { mode: 'json' }) : text({ mode: 'json' });
export const boolean = (name?: string) =>
  name ? integer(name, { mode: 'boolean' }) : integer({ mode: 'boolean' });

// The provenance and soft-delete columns every entity table carries (docs/03 § Table classes),
// fresh builders per call because Drizzle binds a column to one table.
export const stamps = () => ({
  createdAt: time('created_at').notNull().default(now),
  updatedAt: time('updated_at').notNull().default(now),
  createdBy: text('created_by').references(() => users.id),
  updatedBy: text('updated_by').references(() => users.id),
  deletedAt: time('deleted_at'),
  deletedOpId: text('deleted_op_id'),
});
export const workspace = sqliteTable(
  'workspace',
  {
    id: integer().primaryKey().default(1),
    setupCompletedAt: time('setup_completed_at'),
    setupTokenHash: text('setup_token_hash'),
    schemaVersion: integer('schema_version').notNull().default(1),
    maintenanceMode: boolean('maintenance_mode').notNull().default(false),
  },
  (t) => [check('workspace_singleton', sql`${t.id} = 1`)],
);
export const users = sqliteTable(
  'users',
  {
    id: text().primaryKey(),
    email: text().notNull().unique(),
    name: text().notNull(),
    // ADR 0055: Better Auth reads the password from `auth_accounts`; this copy is kept in step so
    // the previous release can still sign in on this database (ADR 0050), until a contract drops it.
    passwordHash: text('password_hash').notNull(),
    // Better Auth's user fields. Every member is added by an administrator, so their address counts
    // as verified; nothing here is shown.
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text(),
    role: text().notNull(),
    isActive: boolean('is_active').notNull().default(true),
    revision: integer().notNull().default(1),
    lastLoginAt: time('last_login_at'),
    passwordChangedAt: time('password_changed_at'),
    // ADMIN-B65: the Google account this user signed in with first; only that one may again.
    googleSubject: text('google_subject'),
    createdAt: time('created_at').notNull().default(now),
    updatedAt: time('updated_at').notNull().default(now),
    createdBy: text('created_by'),
    updatedBy: text('updated_by'),
    deletedAt: time('deleted_at'),
    deletedOpId: text('deleted_op_id'),
  },
  (t) => [
    check('users_role_check', sql`${t.role} in ('admin','member')`),
    uniqueIndex('users_google_subject_idx').on(t.googleSubject),
    check('users_email_lower_check', sql`${t.email} = lower(${t.email})`),
  ],
);
export const sessions = sqliteTable(
  'sessions',
  {
    id: text().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    issuedAt: time('issued_at').notNull(),
    lastSeenAt: time('last_seen_at').notNull(),
    expiresAt: time('expires_at').notNull(),
    absoluteExpiresAt: time('absolute_expires_at').notNull(),
    ip: text(),
    userAgent: text('user_agent'),
    revokedAt: time('revoked_at'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);
export const loginAttempts = sqliteTable(
  'login_attempts',
  {
    id: text().primaryKey(),
    email: text().notNull(),
    ip: text().notNull(),
    succeeded: boolean().notNull(),
    createdAt: time('created_at').notNull().default(now),
  },
  (t) => [
    index('login_email_time_idx').on(t.email, t.createdAt),
    index('login_ip_time_idx').on(t.ip, t.createdAt),
  ],
);
// ADMIN-B63: one row per request for a sign-in code, known email or not, which the send throttle
// counts. The code columns are from ADR 0053 and no longer written (ADR 0055).
export const signInCodes = sqliteTable(
  'sign_in_codes',
  {
    id: text().primaryKey(),
    email: text().notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash'),
    attempts: integer().notNull().default(0),
    ip: text().notNull(),
    expiresAt: time('expires_at').notNull(),
    usedAt: time('used_at'),
    createdAt: time('created_at').notNull().default(now),
  },
  (t) => [
    index('sign_in_codes_email_time_idx').on(t.email, t.createdAt),
    index('sign_in_codes_ip_time_idx').on(t.ip, t.createdAt),
    index('sign_in_codes_user_idx').on(t.userId),
  ],
);
export const recoveryTokens = sqliteTable('recovery_token_uses', {
  tokenHash: text('token_hash').primaryKey(),
  usedAt: time('used_at').notNull().default(now),
});
export const settings = sqliteTable(
  'settings',
  {
    key: text().notNull(),
    scope: text().notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    value: json().notNull(),
    updatedBy: text('updated_by').references(() => users.id),
    updatedAt: time('updated_at').notNull().default(now),
  },
  (t) => [
    check(
      'settings_scope_owner_check',
      sql`(${t.scope} = 'workspace' and ${t.userId} is null) or (${t.scope} = 'user' and ${t.userId} is not null)`,
    ),
    // `settings_scope_key` (unique on key, scope, coalesce(user_id, '')) is hand-written in
    // drizzle/0000_initial.sql and declared in custom-objects.json: drizzle-kit's SQLite generator
    // splits an index expression on its comma.
    index('settings_user_idx').on(t.userId),
    index('settings_actor_idx').on(t.updatedBy),
  ],
);
export const idempotencyKeys = sqliteTable(
  'idempotency_keys',
  {
    key: text().notNull(),
    userId: text('user_id').notNull(),
    requestHash: text('request_hash').notNull(),
    status: integer().notNull(),
    body: json().notNull(),
    createdAt: time('created_at').notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);
export const jobs = sqliteTable(
  'jobs',
  {
    id: text().primaryKey(),
    kind: text().notNull(),
    dedupKey: text('dedup_key'),
    payload: json().notNull(),
    status: text().notNull().default('queued'),
    priority: integer().notNull().default(0),
    attempt: integer().notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    runAfter: time('run_after').notNull().default(now),
    deadlineAt: time('deadline_at'),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: time('lease_expires_at'),
    cancelRequested: boolean('cancel_requested').notNull().default(false),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    result: json(),
    lastError: text('last_error'),
    createdBy: text('created_by'),
    createdAt: time('created_at').notNull().default(now),
    startedAt: time('started_at'),
    finishedAt: time('finished_at'),
  },
  (t) => [
    uniqueIndex('jobs_active_dedup')
      .on(t.dedupKey)
      .where(sql`${t.status} in ('queued','running')`),
    index('jobs_claim_idx').on(t.status, t.runAfter, t.priority),
    index('jobs_kind_idx').on(t.kind, t.status),
    index('jobs_entity_idx').on(t.entityType, t.entityId),
    check(
      'jobs_status_check',
      sql`${t.status} in ('queued','running','succeeded','failed','cancelled')`,
    ),
  ],
);
export const jobAttempts = sqliteTable(
  'job_attempts',
  {
    id: text().primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    attempt: integer().notNull(),
    leaseOwner: text('lease_owner').notNull(),
    startedAt: time('started_at').notNull().default(now),
    finishedAt: time('finished_at'),
    status: text().notNull(),
    error: text(),
  },
  (t) => [
    uniqueIndex('job_attempt_unique').on(t.jobId, t.attempt),
    check(
      'attempts_status_check',
      sql`${t.status} in ('running','succeeded','failed','abandoned')`,
    ),
  ],
);
export const schedules = sqliteTable('schedules', {
  id: text().primaryKey(),
  kind: text().notNull(),
  cron: text().notNull(),
  timezone: text().notNull(),
  payload: json().notNull(),
  enabled: boolean().notNull().default(true),
  lastOccurrence: time('last_occurrence'),
  createdAt: time('created_at').notNull().default(now),
  updatedAt: time('updated_at').notNull().default(now),
});
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text().primaryKey(),
    actorId: text('actor_id'),
    action: text().notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    opId: text('op_id'),
    diff: json().notNull(),
    createdAt: time('created_at').notNull().default(now),
  },
  (t) => [
    index('audit_entity_idx').on(t.entityType, t.entityId),
    index('audit_actor_idx').on(t.actorId),
    index('audit_time_idx').on(t.createdAt),
  ],
);
export const files = sqliteTable(
  'files',
  {
    id: text().primaryKey(),
    storageKey: text('storage_key').notNull().unique(),
    originalName: text('original_name').notNull(),
    mime: text().notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text().notNull(),
    pageCount: integer('page_count'),
    availability: text().notNull().default('available'),
    archivedAt: time('archived_at'),
    uploadedBy: text('uploaded_by'),
    createdAt: time('created_at').notNull().default(now),
  },
  (t) => [
    check('files_availability_check', sql`${t.availability} in ('available','archived','missing')`),
  ],
);
export const aiInvocations = sqliteTable(
  'ai_invocations',
  {
    id: text().primaryKey(),
    jobId: text('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    capability: text().notNull(),
    capabilityVersion: integer('capability_version').notNull(),
    requestedModel: text('requested_model').notNull(),
    effectiveModel: text('effective_model'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    latencyMs: integer('latency_ms'),
    status: text().notNull(),
    error: text(),
    estimatedCostMicros: integer('estimated_cost_micros'),
    pricingVersion: text('pricing_version'),
    createdBy: text('created_by'),
    createdAt: time('created_at').notNull().default(now),
  },
  (t) => [
    index('ai_invocations_job_idx').on(t.jobId),
    check('ai_status_check', sql`${t.status} in ('ok','error','refused','invalid_output')`),
  ],
);

export const aiCredentials = sqliteTable(
  'ai_credentials',
  {
    id: integer().primaryKey().default(1),
    provider: text().notNull(),
    encryptedKey: text('encrypted_key').notNull(),
    updatedAt: time('updated_at').notNull().default(now),
  },
  (t) => [
    check('ai_credentials_singleton', sql`${t.id} = 1`),
    check('ai_credentials_provider', sql`${t.provider} in ('anthropic', 'openrouter')`),
  ],
);

// ADMIN-B60 (ADR 0053): the outgoing mail server an administrator saved. One row, kept apart from
// the settings registry (ADR 0005); the password is sealed like the AI key.
export const mailSettings = sqliteTable(
  'mail_settings',
  {
    id: integer().primaryKey().default(1),
    host: text().notNull(),
    port: integer().notNull(),
    username: text().notNull(),
    encryptedPassword: text('encrypted_password'),
    fromAddress: text('from_address').notNull(),
    updatedAt: time('updated_at').notNull().default(now),
  },
  (t) => [check('mail_settings_singleton', sql`${t.id} = 1`)],
);

// ADMIN-B65 (ADR 0053): the Google OAuth client an administrator saved. One row; the client secret
// is sealed like the mail password.
export const googleSettings = sqliteTable(
  'google_settings',
  {
    id: integer().primaryKey().default(1),
    clientId: text('client_id').notNull(),
    encryptedSecret: text('encrypted_secret').notNull(),
    updatedAt: time('updated_at').notNull().default(now),
  },
  (t) => [check('google_settings_singleton', sql`${t.id} = 1`)],
);

// ADR 0022: one row per recipient, addressed to a user and never to a person — external people
// have no login and must never accumulate a feed. `subject_type`/`subject_id` are a soft reference
// resolved through the owning module at read time (NOTIF-B06), so there is no foreign key to five
// module tables and a deleted subject drops out of the feed rather than dangling.
export const notifications = sqliteTable(
  'notifications',
  {
    id: text().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text().notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    payload: json().notNull().default({}),
    // Null for the scheduled kinds: the clock is not an actor (NOTIF-B05).
    actorId: text('actor_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: time('created_at').notNull().default(now),
    readAt: time('read_at'),
  },
  (t) => [
    index('notifications_feed_idx').on(t.userId, t.readAt, sql`${t.createdAt} desc`),
    index('notifications_actor_idx').on(t.actorId),
    // NOTIF-I02: at most one unread row per subject and kind, which is what makes emission an
    // idempotent upsert — a task reassigned four times is one unread line, not four.
    uniqueIndex('notifications_unread_subject_idx')
      .on(t.userId, t.kind, t.subjectId)
      .where(sql`${t.readAt} is null`),
    check(
      'notifications_kind_check',
      sql`${t.kind} in ('task.assigned','task.due_today','task.overdue','note.mentioned','kpi.off_target','job.finished','update.installed','update.failed','update.rollback_failed','update.blocked','update.stalled')`,
    ),
  ],
);
