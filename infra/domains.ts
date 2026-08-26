/**
 * The stage-aware hostnames both halves of the stack share.
 *
 * The API and the web sit on the same registrable domain, `kansochess.app`, so
 * Cloudflare's included `*.kansochess.app` certificate covers them both and no
 * second certificate is bought. The web serves the apex and the API one label
 * deep. Two levels deep would read better but has nothing to present at the
 * edge, and covering deeper names is a paid Cloudflare add-on. One label is the
 * cheap, boring choice.
 *
 * Extracted here rather than repeated in `api.ts` and `web.ts` so the two
 * cannot drift: the web bakes the API's hostname into its bundle, and a typo
 * there is a broken deploy nobody sees until the first cross-origin request.
 */
export const apiHostname =
  $app.stage === 'production' ? 'api.kansochess.app' : `${$app.stage}-api.kansochess.app`;

export const webHostname =
  $app.stage === 'production' ? 'kansochess.app' : `${$app.stage}-app.kansochess.app`;
