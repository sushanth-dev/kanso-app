/**
 * better-auth owns these tables (ADR-0011). Once better-auth is installed, this
 * file is regenerated with `npx @better-auth/cli generate` and hand edits are
 * lost. Only `user` is declared here, because it is the only auth table our own
 * schema takes a foreign key against. `session`, `account`, and `verification`
 * arrive with the generator in the story that wires up authentication.
 */
import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
