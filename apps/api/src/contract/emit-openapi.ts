/**
 * Writes `openapi.json` from the route definitions.
 *
 * ADR-0013 makes the OpenAPI document generated rather than written, and the
 * frontend's client is generated from it in turn. Nobody hand-edits either one.
 * Run with `npm run openapi`.
 */
import { writeFile } from 'node:fs/promises';
import { OpenAPIHono } from '@hono/zod-openapi';
import { routes } from './routes.ts';

const app = new OpenAPIHono();

for (const route of routes) {
  app.openAPIRegistry.registerPath(route);
}

app.openAPIRegistry.registerComponent('securitySchemes', 'cookieAuth', {
  type: 'apiKey',
  in: 'cookie',
  name: 'better-auth.session_token',
  description: 'Session cookie issued by better-auth (ADR-0011).',
});

const document = app.getOpenAPI31Document({
  openapi: '3.1.0',
  info: {
    title: 'Chess improvement app API',
    version: '0.1.0',
    description:
      'Version one. Every route traces to a requirement in the business analysis. Authentication routes are mounted by better-auth and are not described here.',
  },
  security: [{ cookieAuth: [] }],
  tags: [
    { name: 'Account', description: 'The login, the players it plays as, and the adults who pay.' },
    { name: 'Import', description: 'Getting games in, by username or by upload.' },
    { name: 'Games', description: 'Stored games and their evaluations.' },
    { name: 'Analysis', description: 'Queueing engine analysis and watching it finish.' },
    { name: 'Report', description: 'The cross-game diagnosis, ranked by rating leak.' },
    { name: 'Coaching', description: 'Prose over engine-verified facts.' },
    { name: 'Focus', description: 'What to work on, and whether it worked.' },
    { name: 'Proof sheet', description: 'The page a coach sends a parent.' },
  ],
});

const out = new URL('../../openapi.json', import.meta.url);
await writeFile(out, `${JSON.stringify(document, null, 2)}\n`);
console.log(
  `Wrote ${out.pathname} with ${Object.keys(document.paths ?? {}).length} paths and ${routes.length} operations.`,
);
