/**
 * The tournament identity rule (ST-011).
 *
 * This is the one place that decides which tournament a game belongs to. Both
 * the importer and the backfill call it, so there is one grouping rather than
 * two that agree today. It is pure: no database, no request, no clock.
 *
 * Two tournament-stream games belong to the same tournament when all three
 * hold:
 *
 * 1. Their normalised event names are equal. Normalising is lowercasing,
 *    trimming, and collapsing runs of whitespace to one space. Nothing fuzzier.
 * 2. Their normalised sites are equal, where two missing sites count as equal.
 * 3. Their play dates are within 30 days of each other, measured against the
 *    date range of the tournament as it stands. A game with no date joins on
 *    the first two conditions alone.
 *
 * The 30-day window is what separates the same annual event in two different
 * years. It is a knob, not a law: a named constant with the reasoning beside
 * it, and the first thing to change if real seasons say it is wrong.
 */

/** The window that separates the same annual event in two different years. */
export const TOURNAMENT_WINDOW_DAYS = 30;

const WINDOW_MS = TOURNAMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * Lowercase, trim, and collapse runs of whitespace to one space. A value that
 * normalises to nothing is null, because a name made of whitespace cannot
 * identify anything.
 */
export function normaliseEventName(name: string | null): string | null {
  if (name == null) return null;
  const normalised = name.trim().toLowerCase().replace(/\s+/g, ' ');
  return normalised === '' ? null : normalised;
}

/** The same normalisation as the event name; a whitespace-only site is null. */
export function normaliseSite(site: string | null): string | null {
  if (site == null) return null;
  const normalised = site.trim().toLowerCase().replace(/\s+/g, ' ');
  return normalised === '' ? null : normalised;
}

/**
 * The normalised identity a game carries. `key` is null when the event tag is
 * missing or normalises to nothing, which is the unattached case: a
 * tournament-stream game with no event we can name has no tournament.
 */
export interface GameIdentity {
  key: string | null;
  site: string | null;
}

export function identityOf(event: string | null, site: string | null): GameIdentity {
  return { key: normaliseEventName(event), site: normaliseSite(site) };
}

/**
 * Whether a game's date falls within the tournament's window, measured against
 * the date range as it stands. A game with no date joins on the identity alone.
 *
 * A game inside the range belongs regardless of how far it is from either end
 * (a tournament can span more than the window). A game outside the range
 * belongs only when it is within the window of an end, which is what lets the
 * range grow as earlier or later games attach. A stored tournament always has
 * both ends set (its first game sets both), so the one-sided branches below are
 * defensive rather than expected.
 */
export function withinWindow(
  playedAt: Date | null,
  startedAt: Date | null,
  endedAt: Date | null,
): boolean {
  if (playedAt == null) return true;
  const at = playedAt.getTime();
  const start = startedAt?.getTime();
  const end = endedAt?.getTime();
  // No range yet: nothing bounds the game.
  if (start == null && end == null) return true;
  // Inside the range, or within the window of either end. A game just after
  // the tournament's end is still within 30 days of it and attaches, which is
  // how the range grows.
  if (start != null && end != null && at >= start && at <= end) return true;
  if (start != null && Math.abs(at - start) <= WINDOW_MS) return true;
  if (end != null && Math.abs(at - end) <= WINDOW_MS) return true;
  return false;
}

/**
 * Whether a game belongs to a stored tournament.
 *
 * The tournament's `key` is already normalised (it is stored that way); its
 * `site` is stored as the player's file wrote it, so it is normalised here for
 * comparison. A game with no normalisable event never belongs to any
 * tournament, even when its site matches.
 */
export function belongsToTournament(
  game: { event: string | null; site: string | null; playedAt: Date | null },
  tournament: {
    key: string;
    site: string | null;
    startedAt: Date | null;
    endedAt: Date | null;
  },
): boolean {
  const identity = identityOf(game.event, game.site);
  if (identity.key == null) return false;
  if (identity.key !== tournament.key) return false;
  if (identity.site !== normaliseSite(tournament.site)) return false;
  return withinWindow(game.playedAt, tournament.startedAt, tournament.endedAt);
}
