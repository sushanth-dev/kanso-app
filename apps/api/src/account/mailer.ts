/**
 * The mailer seam: how a consent notice reaches a guardian, and nothing else.
 *
 * The story turns on the notice email actually being sent, so the production
 * default is Resend over HTTPS (ADR-0042) and it fails loud when unconfigured
 * rather than issuing a consent link that was never mailed. Tests pass a fake
 * that records calls, the way the session reader is a seam, so no test path
 * ever reaches the provider.
 *
 * There is no SDK package: the client is a `fetch` call to Resend's REST API,
 * with the key carried in `RESEND_API_KEY` from the deploy shell. Resend has
 * no LocalStack stand-in, so the request shape is proven by a local HTTP
 * recorder (`mailer.test.ts`) instead of a hosted fake.
 */
import { appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Mailer {
  sendConsentNotice(input: { to: string; confirmUrl: string }): Promise<void>;
  sendPasswordReset(input: { to: string; resetUrl: string }): Promise<void>;
}

export interface ResendConfig {
  fromAddress: string;
  apiKey: string;
}

export function resendConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ResendConfig | null {
  // An empty key is an unset key: the deploy wiring sends
  // `RESEND_API_KEY: process.env.RESEND_API_KEY ?? ''` (infra/api.ts), the
  // same empty-vs-unset guard the Z.AI seam needed (ST-107).
  const fromAddress = env.MAIL_FROM_ADDRESS;
  const apiKey = env.RESEND_API_KEY;
  return fromAddress && apiKey ? { fromAddress, apiKey } : null;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

// One request per send: `fetch` holds no connection pool, so the per-process
// client the SES SDK needed has nothing here to be kept alive for.
async function send(
  config: ResendConfig,
  email: { to: string; subject: string; text: string },
): Promise<void> {
  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.fromAddress,
      to: [email.to],
      subject: email.subject,
      text: email.text,
      html: `<p>${email.text}</p>`,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Resend answered ${response.status} for the "${email.subject}" email to ${email.to}: ${await response.text()}`,
    );
  }
}

export function resendMailer(config: ResendConfig | null): Mailer {
  return {
    async sendConsentNotice({ to, confirmUrl }) {
      if (config === null) {
        throw new Error(
          'RESEND_API_KEY or MAIL_FROM_ADDRESS is not set: a guardian consent notice cannot be sent. See .env.example.',
        );
      }
      await send(config, {
        to,
        subject: 'Confirm your consent',
        text: `A minor signed up for KansoChess and named you as their guardian. Open this link to confirm you give consent: ${confirmUrl}`,
      });
    },
    async sendPasswordReset({ to, resetUrl }) {
      if (config === null) {
        throw new Error(
          'RESEND_API_KEY or MAIL_FROM_ADDRESS is not set: a password reset link cannot be sent. See .env.example.',
        );
      }
      await send(config, {
        to,
        subject: 'Reset your KansoChess password',
        text: `Open this link to reset your KansoChess password: ${resetUrl}`,
      });
    },
  };
}

/** Where the stubbed mailer records consent links; shared with the e2e spec. */
const STUB_DESTINATION = join(tmpdir(), 'kanso-consent-links.log');
/** Where the stubbed mailer records reset links; shared with the e2e spec. */
const RESET_STUB_DESTINATION = join(tmpdir(), 'kanso-reset-links.log');

/**
 * The stubbed mailer for the Playwright consent journey (ST-053). A minor
 * sign-up under `MAILER_STUB=1` records the consent link to a file instead of
 * sending through SES, so the browser journey can read the link back and open
 * the confirm page. It is test infrastructure: the flag is never set in a
 * deployed environment.
 */
export function stubMailer(): Mailer {
  return {
    async sendConsentNotice({ confirmUrl }) {
      await appendFile(STUB_DESTINATION, `${confirmUrl}\n`);
    },
    async sendPasswordReset({ resetUrl }) {
      await appendFile(RESET_STUB_DESTINATION, `${resetUrl}\n`);
    },
  };
}
