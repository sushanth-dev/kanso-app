/**
 * CLI-only bootstrap for `@better-auth/cli generate`.
 *
 * The CLI reads an auth config by importing it and reading the exported auth
 * instance's `.options`, so it needs a default export. The real config in
 * `auth.ts` is a factory because the integration tests need an instance bound
 * to their own database, and a factory is not something the CLI can import.
 *
 * This file exists only to give the CLI something to read. The placeholder
 * database is never used: schema generation reads the options, not the
 * adapter. It is never imported by the application or the tests.
 */
import { createAuth } from './auth.ts';

// A stand-in database object. `drizzleAdapter` only reads `provider` from its
// config and never touches the db during schema generation, so this is safe.
// It must not be used at runtime.
const placeholderDb = {} as never;

export default createAuth(placeholderDb, {
  mailer: { async sendConsentNotice() {}, async sendPasswordReset() {} },
});
