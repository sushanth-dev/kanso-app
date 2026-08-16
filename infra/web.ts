/**
 * The web half (ADR-0034): the Vite build served from Cloudflare Workers
 * static assets, on the same edge that already fronts the API.
 *
 * `VITE_API_URL` bakes the API's hostname into the bundle, so the browser
 * calls `https://dev-api.kansochess.app` rather than `localhost`. Attaching
 * the custom domain makes Cloudflare create the proxied web record itself, a
 * CNAME to the Worker's `workers.dev` origin, so neither the token nor the
 * guide touches DNS for the web.
 */
import { apiHostname, webHostname } from './domains.ts';

export const web = new sst.cloudflare.StaticSiteV2('Web', {
  path: 'apps/web',
  build: {
    command: 'npm run build',
    output: 'dist',
  },
  domain: { name: webHostname },
  // TanStack Router uses browser history, so a deep link like /report must
  // serve the app rather than a 404.
  notFound: 'single-page-application',
  environment: {
    VITE_API_URL: `https://${apiHostname}`,
  },
});
