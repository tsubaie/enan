import 'server-only';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { boolean, now, time, users } from './system-schema';
// ADR 0055: Better Auth's own tables, named for it. A session is a row here and its token is the
// cookie's value (signed); `auth_accounts` holds each user's password hash (provider `credential`)
// and linked Google identities; `auth_verifications` holds pending one-time codes, hashed;
// `auth_passkeys` holds each user's WebAuthn public keys (ADR 0064).
export const authSessions = sqliteTable(
  'auth_sessions',
  {
    id: text().primaryKey(),
    token: text().notNull().unique(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: time('expires_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: time('created_at').notNull().default(now),
    updatedAt: time('updated_at').notNull().default(now),
  },
  (t) => [index('auth_sessions_user_idx').on(t.userId)],
);
export const authAccounts = sqliteTable(
  'auth_accounts',
  {
    id: text().primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: time('access_token_expires_at'),
    refreshTokenExpiresAt: time('refresh_token_expires_at'),
    scope: text(),
    password: text(),
    createdAt: time('created_at').notNull().default(now),
    updatedAt: time('updated_at').notNull().default(now),
  },
  (t) => [
    index('auth_accounts_user_idx').on(t.userId),
    uniqueIndex('auth_accounts_provider_idx').on(t.providerId, t.accountId),
  ],
);
export const authVerifications = sqliteTable(
  'auth_verifications',
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: time('expires_at').notNull(),
    createdAt: time('created_at').notNull().default(now),
    updatedAt: time('updated_at').notNull().default(now),
  },
  (t) => [index('auth_verifications_identifier_idx').on(t.identifier)],
);
export const authPasskeys = sqliteTable(
  'auth_passkeys',
  {
    id: text().primaryKey(),
    name: text(),
    publicKey: text('public_key').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // The plugin's own field name, which the adapter matches on.
    credentialID: text('credential_id').notNull(),
    counter: integer().notNull(),
    deviceType: text('device_type').notNull(),
    backedUp: boolean('backed_up').notNull(),
    transports: text(),
    createdAt: time('created_at').notNull().default(now),
    aaguid: text(),
  },
  (t) => [
    index('auth_passkeys_user_idx').on(t.userId),
    uniqueIndex('auth_passkeys_credential_idx').on(t.credentialID),
  ],
);
