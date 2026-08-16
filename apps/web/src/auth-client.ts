import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields } from 'better-auth/client/plugins';

/**
 * The client mirrors the server's `user.additionalFields` so `signUp.email`
 * types the date of birth and guardian email (ST-034). This is the client-side
 * half of the same declaration in `apps/api/src/auth.ts`; the two must stay in
 * sync the way a client and server contract always must.
 */
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  plugins: [
    inferAdditionalFields({
      user: {
        dateOfBirth: { type: 'string', required: false },
        guardianEmail: { type: 'string', required: false },
      },
    }),
  ],
});
