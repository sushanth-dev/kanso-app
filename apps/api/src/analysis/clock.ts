/**
 * ST-025. Parse the `%clk` annotation chess.js surfaces as a move comment.
 *
 * Providers write the remaining clock as `[%clk H:MM:SS]` (Lichess also writes
 * fractional seconds as `H:MM:SS.mmm`). This is untrusted text: a value that is
 * not a time must not throw and must not be read as zero. It returns null and
 * the caller counts it as missing, per the story's security assessment.
 */
export function parseClockMs(comment: string): number | null {
  const match = /%clk\s*(\d{1,2}):(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?/.exec(comment);
  if (match === null) return null;

  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  // MM and SS outside 0-59 mean the text is not a clock, not a real time.
  if (minutes > 59 || seconds > 59) return null;

  const hours = Number(match[1]);
  const fraction = match[4] ? Number(`0.${match[4]}`) : 0;
  return Math.round((hours * 3600 + minutes * 60 + seconds + fraction) * 1000);
}
