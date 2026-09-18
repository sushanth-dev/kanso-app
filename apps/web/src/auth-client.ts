import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields } from 'better-auth/client/plugins';
import { apiBaseUrl } from './api/base-url.ts';

/**
 * The client mirrors the server's `user.additionalFields` so `signUp.email`
 * types the date of birth and guardian email (ST-034). This is the client-side
 * half of the same declaration in `apps/api/src/auth.ts`; the two must stay in
 * sync the way a client and server contract always must.
 *
 * `privacyAcknowledgedAt` (ST-166) crosses the same boundary for the same
 * reason: the sign-up screen sends the acknowledgement and the account row
 * records it. The value the client sends is only the claim that the box was
 * ticked; the server replaces it with its own clock before the row is written.
 */
export const authClient = createAuthClient({
  baseURL: apiBaseUrl,
  plugins: [
    inferAdditionalFields({
      user: {
        dateOfBirth: { type: 'string', required: false },
        guardianEmail: { type: 'string', required: false },
        privacyAcknowledgedAt: { type: 'date', required: false },
      },
    }),
  ],
});
