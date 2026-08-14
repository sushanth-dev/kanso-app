/**
 * The SES mailer against a real SES, provided by LocalStack.
 *
 * Not a mocked client: the failure this catches is a malformed `SendEmail`
 * payload or a wrong endpoint, and a stand-in accepts both. The consent flow in
 * `guardian-consent.integration.test.ts` uses a fake; this is the one test that
 * proves the real sender works. `docs/guides/local-setup.md` has the container
 * command, now with `SERVICES=ses,sqs`.
 *
 * Skipped when `AWS_ENDPOINT_URL` is unset, because without it the SDK talks to
 * real AWS with whatever credentials the machine happens to hold, and a test
 * that sends email from an account nobody asked about is worse than a test that
 * did not run. CI sets it, so CI runs these.
 */
import { DeleteIdentityCommand, SESClient, VerifyEmailIdentityCommand } from '@aws-sdk/client-ses';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { sesConfigFromEnv, sesMailer, type SesConfig } from './mailer.ts';
import { localstackClientOptions } from '../localstack.ts';

const endpoint = process.env.AWS_ENDPOINT_URL;

const SENDER = 'sender@example.com';
const RECIPIENT = 'guardian@example.com';

const ses = new SESClient(endpoint ? { endpoint, ...localstackClientOptions } : {});

describe.skipIf(endpoint === undefined)('sesMailer', () => {
  beforeAll(async () => {
    await ses.send(new VerifyEmailIdentityCommand({ EmailAddress: SENDER }));
  });

  afterAll(async () => {
    if (process.env.KEEP_SES_IDENTITY === '1') return;
    await ses.send(new DeleteIdentityCommand({ Identity: SENDER }));
  });

  test('sends the consent notice with the confirm link', async () => {
    const config: SesConfig = { fromAddress: SENDER, endpoint };
    const mailer = sesMailer(config);
    const confirmUrl = 'http://localhost:3000/guardians/confirm/some-token';

    await expect(mailer.sendConsentNotice({ to: RECIPIENT, confirmUrl })).resolves.toBeUndefined();

    // LocalStack stores sent mail behind its internal endpoint; SES has no
    // public "list sent" API, so this is how the send is proven, not accepted.
    const response = await fetch(`${endpoint}/_aws/ses`);
    const body = (await response.json()) as {
      messages: Array<{ Destination?: { ToAddresses?: string[] }; Body?: { text_part?: string } }>;
    };
    const notice = body.messages.find(
      (message) =>
        message.Destination?.ToAddresses?.includes(RECIPIENT) &&
        message.Body?.text_part?.includes(confirmUrl),
    );
    expect(notice).toBeDefined();
  });

  test('reads its configuration from the environment', () => {
    const before = process.env.SES_FROM_ADDRESS;
    try {
      delete process.env.SES_FROM_ADDRESS;
      expect(sesConfigFromEnv()).toBeNull();

      process.env.SES_FROM_ADDRESS = SENDER;
      expect(sesConfigFromEnv()).toEqual({ fromAddress: SENDER, endpoint });
    } finally {
      if (before === undefined) delete process.env.SES_FROM_ADDRESS;
      else process.env.SES_FROM_ADDRESS = before;
    }
  });
});
