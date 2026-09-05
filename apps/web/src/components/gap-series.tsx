import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import type { TransferGapSeries } from '../api/diagnosis-api.ts';

/**
 * ST-120. The gap across the season, under the gap card: one point per
 * imported tournament, x by the event's date, y by the gap the API computed
 * from the same inputs ST-018 uses. Nothing is recomputed here - the chart
 * plots served numbers and the states name what is missing.
 */

export type GapSeriesState =
  'chart' | 'no_tournaments' | 'unrated_only' | 'no_online_rating' | 'one_event';

/**
 * The honest states, ordered by the action they name: nothing imported yet
 * means import; events without plottable points say so; a missing online
 * rating points at the fetch; a single event draws its one point but refuses
 * to call it a trend.
 */
export function gapSeriesState(
  series: Pick<TransferGapSeries, 'onlineRating' | 'points' | 'skippedTournaments'>,
): GapSeriesState {
  if (series.points.length === 0) {
    return series.skippedTournaments > 0 ? 'unrated_only' : 'no_tournaments';
  }
  if (series.onlineRating === null) return 'no_online_rating';
  if (series.points.length === 1) return 'one_event';
  return 'chart';
}

/** Signed rating points; zero carries no sign, matching the gap card. */
export function gapLabel(gap: number): string {
  return gap > 0 ? `+${gap}` : `${gap}`;
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/** Chart geometry in viewBox units; the whole SVG scales as one block. */
const WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 30, right: 48, bottom: 28, left: 56 } as const;

function platformName(platform: 'chesscom' | 'lichess'): string {
  return platform === 'chesscom' ? 'Chess.com rapid' : 'Lichess rapid';
}

function referenceLabel(series: TransferGapSeries): string {
  return `${platformName(series.platform!)} ${series.onlineRating}`;
}

function SeriesSvg({ series }: { series: TransferGapSeries }) {
  const points = series.points;
  const gaps = points.map((p) => p.gap!);
  const first = points[0]!;
  const last = points[points.length - 1]!;

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  // The y domain always shows the zero rule: it is the reference the story
  // pins, and a gap only means something against it. A narrow domain still
  // breathes, so a lone point is never pinned to both frames.
  let lo = Math.min(0, ...gaps);
  let hi = Math.max(0, ...gaps);
  // Rounded to fifties so the ticks read clean figures, not domain spillover.
  const pad = Math.ceil(Math.max(50, (hi - lo) * 0.15) / 50) * 50;
  lo -= pad;
  hi += pad;

  const firstMs = new Date(first.date).getTime();
  const lastMs = new Date(last.date).getTime();
  const x = (iso: string) => {
    const ms = new Date(iso).getTime();
    if (firstMs === lastMs) return PAD.left + plotW / 2;
    return PAD.left + ((ms - firstMs) / (lastMs - firstMs)) * plotW;
  };
  const y = (gap: number) => PAD.top + ((hi - gap) / (hi - lo)) * plotH;

  const line = points.map((p) => `${x(p.date)},${y(p.gap!)}`).join(' ');
  // The zero tick doubles the reference rule, so the line and the axis agree.
  const yTicks = [hi, 0, lo];
  const tickIndices =
    points.length <= 4
      ? points.map((_, i) => i)
      : [0, Math.floor((points.length - 1) / 2), points.length - 1];

  const ariaLabel =
    `Your gap to ${referenceLabel(series)} across ${points.length} ` +
    (points.length === 1 ? 'tournament' : 'tournaments') +
    (points.length === 1
      ? `: ${gapLabel(first.gap!)} at ${first.name}.`
      : `, from ${gapLabel(first.gap!)} at ${first.name} to ${gapLabel(last.gap!)} at ${last.name}.`);

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
      {/* Y ticks: signed rating points, mono per the tabular rule. */}
      {yTicks.map((tick) => (
        <text
          key={tick}
          x={PAD.left - 8}
          y={y(tick) + 4}
          textAnchor="end"
          className="fill-muted font-mono text-xs"
        >
          {gapLabel(Math.round(tick))}
        </text>
      ))}
      {/* X ticks: the events' own dates, at the points they name. */}
      {tickIndices.map((i) => (
        <text
          key={i}
          x={x(points[i]!.date)}
          y={HEIGHT - PAD.bottom + 18}
          textAnchor="middle"
          className="fill-muted font-mono text-xs"
        >
          {dateFormatter.format(new Date(points[i]!.date))}
        </text>
      ))}
      {/* The reference: the latest online rating, the zero every point reads
          against. Dashed with a text label - never hue alone. */}
      <line
        x1={PAD.left}
        y1={y(0)}
        x2={WIDTH - PAD.right}
        y2={y(0)}
        strokeDasharray="4 4"
        className="stroke-border-strong"
      />
      <text
        x={PAD.left + 6}
        y={y(0) < PAD.top + 24 ? y(0) + 14 : y(0) - 6}
        className="fill-muted font-mono text-xs"
      >
        {referenceLabel(series)}
      </text>
      {/* The series */}
      {points.length > 1 ? (
        <polyline points={line} fill="none" strokeWidth={2} className="stroke-primary" />
      ) : null}
      {points.map((p) => (
        <circle
          key={p.tournamentId}
          cx={x(p.date)}
          cy={y(p.gap!)}
          r={3.5}
          className="fill-primary"
        />
      ))}
      {/* The latest gap, labelled at the series' end. */}
      <text
        x={x(last.date) + (x(last.date) > WIDTH - 90 ? -8 : 8)}
        y={y(last.gap!) - 8}
        textAnchor={x(last.date) > WIDTH - 90 ? 'end' : 'start'}
        className="fill-primary font-mono text-xs"
      >
        {gapLabel(last.gap!)}
      </text>
    </svg>
  );
}

const THIN_COPY: Record<Exclude<GapSeriesState, 'chart'>, (series: TransferGapSeries) => string> = {
  no_tournaments: () =>
    'No tournament games yet. Upload a tournament and the gap gets its first point.',
  unrated_only: (series) =>
    series.skippedTournaments === 1
      ? 'Your one tournament carries no player rating in its games, so there is nothing to plot yet.'
      : `None of your ${series.skippedTournaments} tournaments carry a player rating in their games, so there is nothing to plot yet.`,
  no_online_rating: () =>
    'No online rating fetched yet. Set a Chess.com or Lichess username on your account and refresh the ratings; every point reads against your latest online rating.',
  one_event: () =>
    'One tournament so far. The direction needs a second event - one point is not a trend.',
};

/** The gap series card, or the honest state naming what is missing. */
export function GapSeriesCard({ series }: { series: TransferGapSeries }) {
  const state = gapSeriesState(series);
  return (
    <Card className="space-y-2 p-4">
      <Heading level={2}>The gap across the season</Heading>
      <Text as="p" display="block" type="supporting" className="mt-1 text-sm">
        One point per tournament, against your latest online rating.
      </Text>
      {state !== 'chart' ? (
        <Text as="p" display="block" type="supporting" className="text-sm">
          {THIN_COPY[state](series)}
        </Text>
      ) : (
        <SeriesSvg series={series} />
      )}
      {series.skippedTournaments > 0 ? (
        <Text as="p" display="block" type="supporting" className="text-sm">
          {series.skippedTournaments === 1
            ? 'One other event carries no player rating in its games, so it has no point.'
            : `${series.skippedTournaments} other events carry no player rating in their games, so they have no points.`}
        </Text>
      ) : null}
      {state === 'one_event' ? <SeriesSvg series={series} /> : null}
    </Card>
  );
}
