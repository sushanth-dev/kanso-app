/**
 * ST-040. Classifies a `TimeControl` tag value into its speed bucket, so the
 * online verification window can count blitz and refuse the rest.
 *
 * The tag is a free-text string like "180+2", "5400+30", or "180". We bucket
 * on the base seconds before any `+`, at Chess.com's boundaries: bullet under
 * three minutes, blitz three to under ten, rapid ten to under thirty, and
 * classical thirty and over. Repeating and untimed forms ("40/9000", "-") and
 * anything unparseable return null, so an unclassified game never counts.
 */

export type TimeControlClass = 'bullet' | 'blitz' | 'rapid' | 'classical';

/** The base seconds parsed from a `TimeControl` tag, or null when there is none. */
function parseBaseSeconds(timeControl: string | null): number | null {
  if (timeControl === null) return null;
  const t = timeControl.trim();
  if (t === '' || t === '-') return null;
  if (t.includes('/')) return null; // repeating controls like "40/9000"
  const base = t.split('+')[0];
  if (base === undefined) return null;
  const match = /^(\d+)$/.exec(base);
  if (match === null) return null;
  return Number(match[1]);
}

export function classifyTimeControl(timeControl: string | null): TimeControlClass | null {
  const base = parseBaseSeconds(timeControl);
  if (base === null) return null;
  if (base < 180) return 'bullet';
  if (base < 600) return 'blitz';
  if (base < 1800) return 'rapid';
  return 'classical';
}
