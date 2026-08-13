/**
 * The localhost guard the operator scripts share (ST-016).
 *
 * The seed writes games, and the backfill reset deletes tournament rows, both
 * into whatever `DATABASE_URL` names. Pointed at a non-local database the
 * reset is a data-integrity event rather than a seed, so the refusal is a hard
 * exit in the caller, never a warning. The guard is a pure function so a unit
 * test can pin it.
 */
export function isLocalhostDatabaseUrl(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}
