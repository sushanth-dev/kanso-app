import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import type { GameDetail, MovePly } from '../api/diagnosis-api.ts';
import { movingColorOf } from './review-pieces.tsx';

/**
 * ST-121. The clock curve under the review's move list: the player's remaining
 * clock per move, drawn from the stored `move_ply` rows, with the report's
 * time-trouble onset (ST-042) marked when present. No engine call and no
 * re-analysis: everything here is already on the game payload.
 */

/** One point on the curve: the player's remaining time after a move. */
export interface ClockReading {
  move: number;
  clockMs: number;
}

/** AC3. The player's own readings only; the opponent's clock never enters. */
export function clockReadings(
  plies: MovePly[],
  playerColor: 'white' | 'black' | null,
): ClockReading[] {
  if (playerColor === null) return [];
  return plies
    .filter((ply) => movingColorOf(ply) === playerColor && ply.clockMs !== null)
    .map((ply) => ({ move: Math.ceil(ply.ply / 2), clockMs: ply.clockMs! }));
}

export type ClockCurveState = 'curve' | 'no_clock_data' | 'not_enough_evidence';

/**
 * AC4. DEBT-016's vocabulary, read per game: no reading on the player's side
 * at all is `no_clock_data`; a single reading cannot draw a line, so it is
 * `not_enough_evidence`. Two or more draw the curve.
 */
export function clockCurveState(readings: ClockReading[]): ClockCurveState {
  if (readings.length === 0) return 'no_clock_data';
  if (readings.length === 1) return 'not_enough_evidence';
  return 'curve';
}

const NO_CLOCK_COPY: Record<'no_clock_data' | 'not_enough_evidence', string> = {
  no_clock_data: 'No clock data on this game, so there is no clock curve.',
  not_enough_evidence: 'Too few clock readings on your moves to draw a clock curve.',
};

/** m:ss, or H:MM:SS once the clock passes the hour. */
export function clockLabel(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Chart geometry in viewBox units; the whole SVG scales as one block. */
const WIDTH = 640;
const HEIGHT = 190;
const PAD = { top: 30, right: 16, bottom: 28, left: 52 } as const;

function CurveSvg({ readings, onsetMove }: { readings: ClockReading[]; onsetMove: number | null }) {
  const first = readings[0]!.move;
  const last = readings[readings.length - 1]!.move;
  // The ceiling rounds up to a whole minute so the top tick reads clean.
  const maxClock = Math.max(
    60_000,
    Math.ceil(Math.max(...readings.map((r) => r.clockMs)) / 60_000) * 60_000,
  );
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (move: number) =>
    first === last ? PAD.left + plotW / 2 : PAD.left + ((move - first) / (last - first)) * plotW;
  const y = (clockMs: number) => PAD.top + (1 - clockMs / maxClock) * plotH;

  const points = readings.map((r) => `${x(r.move)},${y(r.clockMs)}`).join(' ');
  const yTicks = [maxClock, maxClock / 2, 0];
  const xStep = Math.max(1, Math.ceil((last - first) / 8));
  const xTicks: number[] = [];
  for (let move = first; move <= last; move += xStep) xTicks.push(move);

  // AC2. The onset marks the curve only when it lands inside this game; a
  // report onset past the game's last move has nothing to mark.
  const markerX =
    onsetMove !== null && onsetMove >= first && onsetMove <= last ? x(onsetMove) : null;
  const ariaLabel =
    `Your remaining clock after each of your moves, from ${clockLabel(readings[0]!.clockMs)}` +
    ` to ${clockLabel(readings[readings.length - 1]!.clockMs)}` +
    (markerX !== null && onsetMove !== null
      ? `. Time trouble marked from move ${onsetMove}.`
      : '.');

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="w-full text-primary"
    >
      {/* Frame */}
      <line
        x1={PAD.left}
        y1={PAD.top}
        x2={PAD.left}
        y2={HEIGHT - PAD.bottom}
        className="stroke-border-strong"
      />
      <line
        x1={PAD.left}
        y1={HEIGHT - PAD.bottom}
        x2={WIDTH - PAD.right}
        y2={HEIGHT - PAD.bottom}
        className="stroke-border-strong"
      />
      {/* Y ticks: the tabular rule puts every clock figure in the mono face. */}
      {yTicks.map((tick) => (
        <text
          key={tick}
          x={PAD.left - 8}
          y={y(tick) + 4}
          textAnchor="end"
          className="fill-muted font-mono text-xs"
        >
          {clockLabel(tick)}
        </text>
      ))}
      {/* X ticks: move numbers */}
      {xTicks.map((move) => (
        <text
          key={move}
          x={x(move)}
          y={HEIGHT - PAD.bottom + 18}
          textAnchor="middle"
          className="fill-muted font-mono text-xs"
        >
          {move}
        </text>
      ))}
      {/* The curve */}
      <polyline points={points} fill="none" strokeWidth={2} className="stroke-primary" />
      {/* The onset marker: a dashed rule plus a text label, never hue alone. */}
      {markerX !== null && onsetMove !== null ? (
        <g>
          <line
            x1={markerX}
            y1={PAD.top - 4}
            x2={markerX}
            y2={HEIGHT - PAD.bottom}
            strokeDasharray="4 4"
            className="stroke-danger"
          />
          <text
            x={markerX + (markerX > WIDTH - 180 ? -6 : 6)}
            y={PAD.top - 8}
            textAnchor={markerX > WIDTH - 180 ? 'end' : 'start'}
            className="fill-danger font-mono text-xs"
          >
            Time trouble · move {onsetMove}
          </text>
        </g>
      ) : null}
    </svg>
  );
}

/** The clock curve card, or the honest no-clock state naming its reason. */
export function ClockCurve({ game }: { game: GameDetail }) {
  const readings = clockReadings(game.plies, game.playerColor);
  const state = clockCurveState(readings);
  return (
    <Card className="space-y-2 p-4">
      <Heading level={3}>Clock</Heading>
      {game.playerColor === null ? (
        <Text as="p" display="block" type="supporting" className="text-sm">
          Set your colour above to see how your clock spent the game.
        </Text>
      ) : state !== 'curve' ? (
        <Text as="p" display="block" type="supporting" className="text-sm">
          {NO_CLOCK_COPY[state]}
        </Text>
      ) : (
        <CurveSvg readings={readings} onsetMove={game.timeTroubleFromMove} />
      )}
    </Card>
  );
}
