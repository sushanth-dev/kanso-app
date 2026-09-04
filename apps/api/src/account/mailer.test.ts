/**
 * The Resend mailer against a local HTTP recorder.
 *
 * The retired SES suite proved the sender against LocalStack because the
 * failure it caught - a malformed `SendEmail` payload - is one a stand-in
 * accepts. Resend has no LocalStack emulation, so the same intent survives as
 * a recorder that intercepts the `fetch` the client makes and asserts the
 * request shape: the bearer auth header and the JSON from/to/subject/text
 * body. A malformed payload still fails a suite instead of passing against a
 * stand-in, and no test path reaches the real API.
 *
 * The consent flow above the seam keeps its fake
 * (`guardian-consent.integration.test.ts`); this is the one test that proves
 * the sender itself.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { resendConfigFromEnv, resendMailer, type ResendConfig } from './mailer.ts';

const config: ResendConfig = {
  fromAddress: 'KansoChess <noreply@kansochess.app>',
  apiKey: 're_test_key',
};

function stubResponse(status: number, body: string) {
  return new Response(body, { status });
}

function recordedEmail(id: string) {
  return stubResponse(200, JSON.stringify({ id }));
}

describe('resendConfigFromEnv', () => {
  test('reads RESEND_API_KEY and MAIL_FROM_ADDRESS', () => {
    expect(
      resendConfigFromEnv({ RESEND_API_KEY: 're_k', MAIL_FROM_ADDRESS: 'noreply@kansochess.app' }),
    ).toEqual({ apiKey: 're_k', fromAddress: 'noreply@kansochess.app' });
  });

  test('is null without the key or the from address, which is the fail-loud path', () => {
    expect(resendConfigFromEnv({})).toBeNull();
    expect(resendConfigFromEnv({ RESEND_API_KEY: 're_k' })).toBeNull();
    expect(resendConfigFromEnv({ MAIL_FROM_ADDRESS: 'noreply@kansochess.app' })).toBeNull();
  });

  test('treats an empty key as unset - the deploy wiring sends one', () => {
    // infra/api.ts interpolates `RESEND_API_KEY: process.env.RESEND_API_KEY ?? ''`,
    // and an empty key must read as unconfigured rather than as a garbage
    // bearer token, exactly as the Z.AI seam treats an empty model name.
    expect(
      resendConfigFromEnv({ RESEND_API_KEY: '', MAIL_FROM_ADDRESS: 'noreply@kansochess.app' }),
    ).toBeNull();
  });
});

describe('resendMailer', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('sends the consent notice shaped as Resend expects', async () => {
    const fetcher = vi.fn().mockResolvedValue(recordedEmail('email-1'));
    vi.stubGlobal('fetch', fetcher);
    const confirmUrl = 'http://localhost:3000/guardians/confirm/some-token';

    await expect(
      resendMailer(config).sendConsentNotice({ to: 'guardian@example.com', confirmUrl }),
    ).resolves.toBeUndefined();

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer re_test_key' });
    const body = JSON.parse(init.body as string) as {
      from: string;
      to: string[];
      subject: string;
      text: string;
      html: string;
    };
    expect(body.from).toBe(config.fromAddress);
    expect(body.to).toEqual(['guardian@example.com']);
    expect(body.subject).toBe('Confirm your consent');
    expect(body.text).toBe(
      `A minor signed up for KansoChess and named you as their guardian. Open this link to confirm you give consent: ${confirmUrl}`,
    );
    expect(body.html).toContain(confirmUrl);
  });

  test('sends the password reset notice the same way', async () => {
    const fetcher = vi.fn().mockResolvedValue(recordedEmail('email-2'));
    vi.stubGlobal('fetch', fetcher);
    const resetUrl = 'http://localhost:3000/reset-password/some-token';

    await expect(
      resendMailer(config).sendPasswordReset({ to: 'guardian@example.com', resetUrl }),
    ).resolves.toBeUndefined();

    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    const body = JSON.parse(init.body as string) as { subject: string; text: string };
    expect(body.subject).toBe('Reset your KansoChess password');
    expect(body.text).toBe(`Open this link to reset your KansoChess password: ${resetUrl}`);
  });

  test('sends the nudge with one CTA, the unsubscribe footer, and the List-Unsubscribe header', async () => {
    const fetcher = vi.fn().mockResolvedValue(recordedEmail('email-3'));
    vi.stubGlobal('fetch', fetcher);
    const importUrl = 'http://localhost:3000/import';
    const unsubscribeUrl = 'http://localhost:3000/nudge/unsubscribe/some-token';

    await expect(
      resendMailer(config).sendNudge({ to: 'player@example.com', importUrl, unsubscribeUrl }),
    ).resolves.toBeUndefined();

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      subject: string;
      text: string;
      html: string;
      headers: Record<string, string>;
    };
    expect(body.subject).toBe('Played this weekend? Import the games');
    // One call to action: the import link appears exactly once in the html,
    // as the anchor. The unsubscribe link is the required footer, not a
    // second CTA, and it is the machine-readable header's value.
    expect(body.html).toContain(`<a href="${importUrl}">Import your games</a>`);
    expect(body.html.split(importUrl)).toHaveLength(2);
    expect(body.html).toContain(`<a href="${unsubscribeUrl}">Unsubscribe from these emails</a>`);
    expect(body.headers['List-Unsubscribe']).toBe(`<${unsubscribeUrl}>`);
    expect(body.text).toContain(importUrl);
    expect(body.text).toContain(unsubscribeUrl);
  });

  test('fails loud when Resend refuses the send, so no link is ever issued unmailed', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        stubResponse(401, JSON.stringify({ name: 'validation_error', message: 'Invalid API key' })),
      );
    vi.stubGlobal('fetch', fetcher);

    await expect(
      resendMailer(config).sendConsentNotice({ to: 'guardian@example.com', confirmUrl: 'u' }),
    ).rejects.toThrow('Resend answered 401');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  test('fails loud unconfigured without touching the provider', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);

    await expect(
      resendMailer(null).sendConsentNotice({ to: 'guardian@example.com', confirmUrl: 'u' }),
    ).rejects.toThrow('RESEND_API_KEY or MAIL_FROM_ADDRESS is not set');
    await expect(
      resendMailer(null).sendPasswordReset({ to: 'guardian@example.com', resetUrl: 'u' }),
    ).rejects.toThrow('RESEND_API_KEY or MAIL_FROM_ADDRESS is not set');
    await expect(
      resendMailer(null).sendNudge({
        to: 'player@example.com',
        importUrl: 'u',
        unsubscribeUrl: 'u',
      }),
    ).rejects.toThrow('RESEND_API_KEY or MAIL_FROM_ADDRESS is not set');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
