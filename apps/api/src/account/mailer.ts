/**
 * The mailer seam: how a consent notice reaches a guardian, and nothing else.
 *
 * The story turns on the notice email actually being sent, so the production
 * default is SES and it fails loud when unconfigured rather than issuing a
 * consent link that was never mailed. Tests pass a fake that records calls,
 * the way the session reader is a seam, so no test path ever reaches SES.
 *
 * The SES client reads region and credentials from the environment exactly the
 * way the SQS client in `analysis/queue.ts` does: the SDK resolves them, and
 * `AWS_ENDPOINT_URL` is set only to point at LocalStack. SES v1 (`client-ses`)
 * rather than v2, because LocalStack's community image emulates v1 only, and a
 * sender that cannot be exercised locally is a sender that cannot be trusted.
 */
import { appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SendEmailCommand, SESClient } from '@aws-sdk/client-ses';
import { localstackClientOptions } from '../localstack.ts';

export interface Mailer {
  sendConsentNotice(input: { to: string; confirmUrl: string }): Promise<void>;
}

export interface SesConfig {
  fromAddress: string;
  /** Set only to point at LocalStack. Unset in every deployed environment. */
  endpoint?: string;
}

export function sesConfigFromEnv(): SesConfig | null {
  const fromAddress = process.env.SES_FROM_ADDRESS;
  if (!fromAddress) return null;
  const endpoint = process.env.AWS_ENDPOINT_URL;
  return endpoint ? { fromAddress, endpoint } : { fromAddress };
}

let client: SESClient | null = null;

// One client per process, for the same reason as the SQS client: the SDK holds
// the connection pool, and rebuilding it per send re-resolves credentials.
function clientFor(config: SesConfig): SESClient {
  client ??= new SESClient(
    config.endpoint ? { endpoint: config.endpoint, ...localstackClientOptions } : {},
  );
  return client;
}

export function sesMailer(config: SesConfig | null): Mailer {
  return {
    async sendConsentNotice({ to, confirmUrl }) {
      if (config === null) {
        throw new Error(
          'SES_FROM_ADDRESS is not set: a guardian consent notice cannot be sent. See .env.example.',
        );
      }
      const ses = clientFor(config);
      await ses.send(
        new SendEmailCommand({
          Source: config.fromAddress,
          Destination: { ToAddresses: [to] },
          Message: {
            Subject: { Data: 'Confirm your consent' },
            Body: {
              Text: {
                Data: `A minor signed up for KansoChess and named you as their guardian. Open this link to confirm you give consent: ${confirmUrl}`,
              },
            },
          },
        }),
      );
    },
  };
}

/** Where the stubbed mailer records consent links; shared with the e2e spec. */
const STUB_DESTINATION = join(tmpdir(), 'kanso-consent-links.log');

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
  };
}
