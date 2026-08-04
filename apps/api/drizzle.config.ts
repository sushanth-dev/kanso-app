import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/db/schema.ts', './src/db/auth-schema.ts'],
  out: './drizzle',
  dbCredentials: {
    // A getter rather than a value, so this throws only for the commands that
    // actually open a connection. `drizzle-kit generate` diffs the schema
    // against the last snapshot and never reads this, so it keeps working with
    // no database and no environment at all.
    //
    // The previous `?? ''` was worse than it looks: an empty connection string
    // does not fail where the mistake was made. It fails later, inside the
    // driver, with a message about a host that is not there, and the person
    // reading it goes looking for a database problem instead of an unset
    // variable.
    get url(): string {
      const url = process.env.DATABASE_URL;
      if (!url) {
        throw new Error(
          'DATABASE_URL is not set. Copy .env.example to .env and fill it in, ' +
            'or export it for this command. See docs/guides/local-setup.md.',
        );
      }
      return url;
    },
  },
  strict: true,
  verbose: true,
});
