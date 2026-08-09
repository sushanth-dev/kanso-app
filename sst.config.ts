// SST writes this file and expects the reference; an import would not bring in
// the ambient globals (`sst`, `$app`, `$interpolate`) the configuration uses.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />

/**
 * The infrastructure, in the same language as the application (ADR-0015).
 *
 * Only what this sprint needs: a VPC, a database, and the API. ST-007 brings
 * the queue and the analysis worker, ST-008 brings the measurement, and each
 * arrives with the story that needs it rather than being scaffolded now.
 */
export default $config({
  app(input) {
    return {
      name: 'kanso',
      // `retain` on production is the setting that stops a mistyped command
      // taking the database with it. Every other stage is removed with the app,
      // because a personal stage nobody deletes is a bill nobody notices.
      removal: input?.stage === 'production' ? 'retain' : 'remove',
      protect: input?.stage === 'production',
      home: 'aws',
      providers: { aws: { region: 'ap-south-2' } },
    };
  },
  async run() {
    const database = await import('./infra/database.ts');
    const api = await import('./infra/api.ts');
    return {
      api: api.router.url,
      database: database.database.host,
    };
  },
});
