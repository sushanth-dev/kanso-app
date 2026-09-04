/**
 * The sign-up-time guardian consent request and the gate it drives (ST-034,
 * ADR-0035).
 *
 * A sign-up that names a minor (under 13) and a guardian email creates a
 * `guardian_consent` row and mails the notice, from the better-auth
 * `user.create.after` hook so the request is made in the same breath as the
 * account rather than by a second client round-trip. The gate reads the same
 * data: a minor with no confirmed consent is blocked from the product until the
 * emailed link is opened.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { user } from '../db/auth-schema.ts';
import * as schema from '../db/schema.ts';
import { guardianConsent } from '../db/schema.ts';
import { signConsentToken } from './consent-token.ts';
import type { Mailer } from './mailer.ts';

type Db = PostgresJsDatabase<typeof schema>;

export const APP_ORIGIN_DEFAULT = 'http://localhost:3000';

function confirmUrlFor(token: string): string {
  const origin = process.env.APP_ORIGIN ?? APP_ORIGIN_DEFAULT;
  return `${origin}/guardians/confirm/${token}`;
}

/** Under 13, the COPPA threshold: today is before the 13th birthday. */
export function isUnder13(dateOfBirth: string, today: Date = new Date()): boolean {
  const thirteenth = new Date(`${dateOfBirth}T00:00:00`);
  thirteenth.setFullYear(thirteenth.getFullYear() + 13);
  return today < thirteenth;
}
/** The sign-up fields the `before` hook validates against the age gate. */
export interface MinorSignup {
  email: string;
  dateOfBirth: string | null;
  guardianEmail: string | null;
}

export function validateMinorSignup(user: MinorSignup): void {
  if (user.dateOfBirth === null || !isUnder13(user.dateOfBirth)) return;
  if (!user.guardianEmail) {
    throw new Error(
      'A guardian email is required when the date of birth makes the person a minor.',
    );
  }
  if (user.guardianEmail === user.email) {
    throw new Error('The guardian email must differ from the sign-up email.');
  }
}

/** The fields the consent hook reads off the better-auth created user. */
export interface NewUser extends MinorSignup {
  id: string;
}

export async function maybeCreateGuardianConsent(
  db: Db,
  mailer: Mailer,
  newUser: NewUser,
): Promise<void> {
  if (newUser.dateOfBirth === null || !isUnder13(newUser.dateOfBirth)) return;
  if (newUser.guardianEmail === null) return;

  const [consent] = await db
    .insert(guardianConsent)
    .values({ userId: newUser.id })
    .returning({ id: guardianConsent.id });
  if (!consent) return;

  await mailer.sendConsentNotice({
    to: newUser.guardianEmail,
    confirmUrl: confirmUrlFor(signConsentToken(consent.id)),
  });
}

/**
 * True when the session belongs to a minor whose guardian has not yet
 * confirmed. A user with no date of birth is not gated: without actual
 * knowledge of age we treat them as an adult, the COPPA posture ADR-0035 names.
 */
export async function isConsentGated(db: Db, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ dateOfBirth: user.dateOfBirth })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!row || row.dateOfBirth === null) return false;
  if (!isUnder13(row.dateOfBirth)) return false;

  const [consent] = await db
    .select({ id: guardianConsent.id })
    .from(guardianConsent)
    .where(and(eq(guardianConsent.userId, userId), isNotNull(guardianConsent.consentGrantedAt)))
    .limit(1);
  return !consent;
}
