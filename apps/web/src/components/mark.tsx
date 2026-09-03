/*
 * The Kanso Chess mark (ST-113): the hero pawn's exact lathe profile
 * (parallax-piece.tsx, pawnProfile()) flattened to two dimensions, with its
 * construction geometry as hairlines - datums in the air, the dome's hidden
 * circle scribed on the piece. The layer that makes it ownable is the
 * product's own story: the analysis drawn over the game.
 *
 * Colour rides the theme tokens, so the mark follows light and high contrast
 * with no variants: accent for the piece, info (the coach-notes token) for
 * the datums, page for the scribes. Strokes are non-scaling so the
 * construction layer stays a crisp hairline at every size instead of turning
 * to sub-pixel mush; the attribute sits on each painted element because
 * vector-effect does not inherit.
 *
 * `plain` drops the construction layer for favicon-scale placements. The
 * standalone favicon files carry the same geometry (public/favicon.svg,
 * generated rasters via scripts/favicon-rasters.mjs).
 */

const PAWN =
  'M 322 830 L 322 735 L 360 735 L 432.2 388.91 A 114 114 0 1 1 591.8 388.91 L 664 735 L 702 735 L 702 830 Z';

const DATUMS = [
  'M 512 148 L 512 185',
  'M 512 838 L 512 884',
  'M 272 830 L 752 830',
  'M 320 735 L 704 735',
  'M 396 388.91 L 628 388.91',
];

const SCRIBES = ['M 500 307.5 L 524 307.5 M 512 295.5 L 512 319.5', 'M 512 307.5 L 591.8 388.91'];

export function Mark({
  size = 24,
  variant = 'full',
}: {
  /** Square edge in px. */
  size?: number;
  /** `plain` drops the construction layer; use at favicon-scale sizes. */
  variant?: 'full' | 'plain';
}) {
  return (
    <svg viewBox="0 0 1024 1024" width={size} height={size} aria-hidden="true">
      {variant === 'full' ? (
        <g fill="none" strokeWidth={1.25} className="stroke-info">
          {DATUMS.map((d) => (
            <path key={d} d={d} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
      ) : null}
      <path d={PAWN} className="fill-accent" />
      {variant === 'full' ? (
        <g fill="none" strokeWidth={1} className="stroke-page">
          <circle cx="512" cy="307.5" r="114" vectorEffect="non-scaling-stroke" />
          {SCRIBES.map((d) => (
            <path key={d} d={d} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
      ) : null}
    </svg>
  );
}
