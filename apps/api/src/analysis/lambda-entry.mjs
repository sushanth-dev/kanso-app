/**
 * The Lambda handler, under a name the runtime can find.
 *
 * The runtime resolves a handler file by .mjs, .js or .cjs and never by .ts, so
 * this re-export exists purely to be that file. Node 24 strips the types off
 * `handler.ts` on import, which is why there is still no build step.
 */
export { handler } from './handler.ts';
