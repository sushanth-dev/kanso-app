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
 *
 * ST-176 puts the analytics gate here too, so that the consent workflow and the
 * PostHog suite answer the age question from one place and one threshold.
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

/**
 * Why the analytics suite's automatic capture is off for an account. The
 * `allowed` half is the gate; the `reason` half is the answer an operator reads
 * in the log line, so "why is replay missing for this account" is a lookup
 * rather than a guess.
 */
export type AnalyticsSuiteReason =
  'stated_adult' | 'consent_recorded' | 'no_stated_age' | 'consent_pending';

export interface AnalyticsSuiteGate {
  allowed: boolean;
  reason: AnalyticsSuiteReason;
}

/**
 * ST-176. Whether the PostHog suite's automatic capture may run for this account:
 * session replay, autocapture, page views, surveys and error reports.
 *
 * Positively established means an age the account itself stated that is outside
 * the gate, or a recorded guardian consent, and nothing else. This is where the
 * suite deliberately diverges from `isConsentGated`: the consent workflow treats
 * an unknown age as an adult, because a sign-up form has to let somebody in, but
 * the suite does not, because silence is not a statement of age and a child's
 * screen should not leave the browser on the strength of an absence. Both read
 * the same threshold through `isUnder13`.
 *
 * The gate reads current account state rather than the state at sign-up, so an
 * account created before this rule existed is treated under the same
 * `no_stated_age` rule as one created after it. A later edit that states an age,
 * or a consent granted later, lifts the gate without a backfill.
 */
export async function analyticsSuiteGate(
  db: Db,
  userId: string,
  dateOfBirth: string | null,
): Promise<AnalyticsSuiteGate> {
  if (dateOfBirth !== null && !isUnder13(dateOfBirth)) {
    return { allowed: true, reason: 'stated_adult' };
  }

  const [consent] = await db
    .select({ id: guardianConsent.id })
    .from(guardianConsent)
    .where(and(eq(guardianConsent.userId, userId), isNotNull(guardianConsent.consentGrantedAt)))
    .limit(1);
  if (consent) return { allowed: true, reason: 'consent_recorded' };

  return { allowed: false, reason: dateOfBirth === null ? 'no_stated_age' : 'consent_pending' };
}
