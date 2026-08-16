/**
 * better-auth owns these tables (ADR-0011). This file is regenerated with
 * `npx @better-auth/cli@1.4.21 generate --config ./src/auth.config.ts --output
 * ./src/db/auth-schema.ts --yes` (run from `apps/api/`), and hand edits are
 * lost on the next run. The CLI is not a committed dependency because it drags
 * in vulnerable transitive packages that fail `npm audit`; regenerate with the
 * pinned `npx` command instead. Only `user` was hand-written before this story;

 * `session`, `account`, and `verification` arrive here with the generator.
 */
import { relations } from 'drizzle-orm';
import { pgTable, text, timestamp, boolean, index } from 'drizzle-orm/pg-core';

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  /**
   * ST-034. The sign-up date of birth as an ISO `YYYY-MM-DD` string. Nullable
   * because accounts that predate minor self-sign-up have none, and because an
   * adult may sign up without one. A string rather than a date column because
   * better-auth's `date` type takes a `Date` object, which JSON sign-up cannot
   * carry; the age gate parses it.
   */
  dateOfBirth: text('date_of_birth'),
  /**
   * ST-034. The guardian email a minor names at sign-up, null for everyone
   * else. The consent state that this email confirms lives in `guardian_consent`,
   * not here.
   */
  guardianEmail: text('guardian_email'),
  // Reconciliation from the better-auth CLI output: the generator emits plain
  // `timestamp`, but every other timestamp in this schema uses
  // `withTimezone: true`. Keeping `user` consistent avoids a no-timezone
  // island and a perpetual ALTER loop on the next `db:generate`. The foreign
  // key `player.owner_user_id` takes against `user.id`, which is unchanged.
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index('session_userId_idx').on(table.userId)],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('account_userId_idx').on(table.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));
