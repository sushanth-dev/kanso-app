/**
 * The mailer seam: how account emails reach players and guardians. Consent
 * notices and password resets go to a guardian or a straying login; the nudge
 * (ST-126) goes to a quiet tournament player, and is the one email that
 * carries List-Unsubscribe headers.
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
  sendNudge(input: { to: string; importUrl: string; unsubscribeUrl: string }): Promise<void>;
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
  email: {
    to: string;
    subject: string;
    text: string;
    html?: string;
    headers?: Record<string, string>;
  },
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
      html: email.html ?? `<p>${email.text}</p>`,
      ...(email.headers ? { headers: email.headers } : {}),
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
    async sendNudge({ to, importUrl, unsubscribeUrl }) {
      if (config === null) {
        throw new Error(
          'RESEND_API_KEY or MAIL_FROM_ADDRESS is not set: a nudge email cannot be sent. See .env.example.',
        );
      }
      await send(config, {
        to,
        subject: 'Played this weekend? Import the games',
        text: [
          'It is easier to import while the rounds are fresh, and every diagnosis',
          'KansoChess offers comes from games you have imported.',
          '',
          `Import your games: ${importUrl}`,
          '',
          `One link stops these emails: ${unsubscribeUrl}`,
        ].join('\n'),
        html: [
          '<p>It is easier to import while the rounds are fresh, and every diagnosis',
          'KansoChess offers comes from games you have imported.</p>',
          `<p><a href="${importUrl}">Import your games</a></p>`,
          `<p><a href="${unsubscribeUrl}">Unsubscribe from these emails</a></p>`,
        ].join(''),
        headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` },
      });
    },
  };
}

/** Where the stubbed mailer records consent links; shared with the e2e spec. */
const STUB_DESTINATION = join(tmpdir(), 'kanso-consent-links.log');
/** Where the stubbed mailer records reset links; shared with the e2e spec. */
const RESET_STUB_DESTINATION = join(tmpdir(), 'kanso-reset-links.log');
/** Where the stubbed mailer records nudge links; test infrastructure only. */
const NUDGE_STUB_DESTINATION = join(tmpdir(), 'kanso-nudge-links.log');

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
    async sendNudge({ importUrl, unsubscribeUrl }) {
      await appendFile(NUDGE_STUB_DESTINATION, `${importUrl} ${unsubscribeUrl}\n`);
    },
  };
}
