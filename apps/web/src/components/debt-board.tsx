/**
 * ST-152. The debt payoff board: one card per recurring group the
 * verification machine knows, rendered from `GET /patterns` alone. The
 * balance is the read model's - instances and cost across the current
 * window - and the only moves it can make are the machine's: a window
 * completing clean retires the debt, an instance brings it back. Solved
 * puzzles never move it; the drill effort sits beside the balance under
 * the standing effort label, so the separation is visible, not implied.
 *
 * Every state carries a second channel - icon and text, never hue alone -
 * and the relapse history survives on the card: the board never erases a
 * came-back, it keeps naming it.
 */
import { Badge } from '@astryxdesign/core/Badge';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { Icon, type IconName } from '@astryxdesign/core/Icon';
import { Link } from '@astryxdesign/core/Link';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Text } from '@astryxdesign/core/Text';
import { useQuery } from '@tanstack/react-query';
import type { PatternState, Stream, Weakness } from '../api/diagnosis-api.ts';
import { patternsQueryOptions } from '../query-client.ts';
import { FigureTypeNote } from './figure-type.tsx';

/** The date the board's copy names: the day a debt retired or came back. */
const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });

/**
 * AC4. The second channel: one icon per state, beside the badge's text.
 * `success` is a paid debt, `info` a window running, `clock` a window too
 * thin to verify, `warning` a debt reopened.
 */
const STATE_ICON: Record<PatternState['state'], IconName> = {
  retired: 'success',
  candidate: 'info',
  not_yet_verifiable: 'clock',
  came_back: 'warning',
  active: 'info',
};

const STATE_LABEL: Record<PatternState['state'], string> = {
  retired: 'Retired',
  candidate: 'Retirement candidate',
  not_yet_verifiable: 'Not yet verifiable',
  came_back: 'Came back',
  active: 'Active',
};

const STATE_VARIANT: Record<PatternState['state'], 'success' | 'info' | 'neutral' | 'warning'> = {
  retired: 'success',
  candidate: 'info',
  not_yet_verifiable: 'neutral',
  came_back: 'warning',
  active: 'info',
};

function StateChip({ state }: { state: PatternState['state'] }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon icon={STATE_ICON[state]} size="sm" aria-hidden />
      <Badge label={STATE_LABEL[state]} variant={STATE_VARIANT[state]} />
    </span>
  );
}

/** The relapse history, kept: the count plus the latest relapse's game. */
function RelapseHistory({ pattern }: { pattern: PatternState }) {
  if (pattern.relapses === 0 || pattern.lastAlertGame === null) return null;
  const latest = pattern.lastAlertGame;
  const when =
    pattern.cameBackAt === null ? null : dateFormatter.format(new Date(pattern.cameBackAt));
  return (
    <Text as="p" display="block" type="supporting" className="text-sm">
      Came back {pattern.relapses === 1 ? 'once' : `${pattern.relapses} times`}
      {when !== null ? `, latest ${when}` : ''} in{' '}
      <Link hasUnderline href={`/games/${latest.gameId}`}>
        {latest.whiteName} vs {latest.blackName}
      </Link>
      .
    </Text>
  );
}

/** One debt card: pattern, balance, state, relapse history, effort, calibration. */
export function DebtCard({ pattern, drilled }: { pattern: PatternState; drilled: number | null }) {
  return (
    <Card className="space-y-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text className="font-display text-base">{pattern.label}</Text>
        <StateChip state={pattern.state} />
      </div>
      {/* ST-175. Every figure on this card is a count: instances and
          half-points across the window, the games in it, the drills beside it,
          the calibration share, and the state read from those counts. None of
          it is modelled, so the card carries no estimate. */}
      <FigureTypeNote
        type="observed"
        detail="counted from these games and your drills, not modelled from engine scores."
      />
      {pattern.state === 'retired' ? (
        <Text as="p" display="block">
          Paid in full: retired{' '}
          {pattern.retiredAt === null ? null : dateFormatter.format(new Date(pattern.retiredAt))} by
          a clean {pattern.stream} window.
        </Text>
      ) : (
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          <div>
            <dt className="font-ui text-xs text-muted">owed</dt>
            <dd className="font-mono">
              {pattern.windowInstances} instances · {pattern.windowCost} half-points
            </dd>
          </div>
          <div>
            <dt className="font-ui text-xs text-muted">window</dt>
            <dd className="font-mono">{pattern.windowGames} games</dd>
          </div>
          {drilled !== null ? (
            <div>
              <dt className="font-ui text-xs text-muted">effort</dt>
              <dd className="font-mono">{drilled} drills</dd>
            </div>
          ) : null}
        </dl>
      )}
      <RelapseHistory pattern={pattern} />
      <CalibrationLine calibration={pattern.calibration} />
    </Card>
  );
}

/**
 * ST-156. The overconfidence line: of the puzzles whose latest drill failed,
 * the share the player rated sure, overall and across the trailing week.
 * ST-175. The count is the row's current state and the rating is the last
 * answer the row holds, so the line names the puzzle rather than claiming the
 * failing drill itself was rated. A group with no answered failed drills
 * renders the honest zero - the line names the absence rather than showing a
 * number.
 */
function CalibrationLine({ calibration }: { calibration: PatternState['calibration'] }) {
  if (calibration === null) {
    return (
      <Text as="p" display="block" type="supporting" className="text-sm">
        No calibration data yet. The drill asks how sure you were before the answer shows.
      </Text>
    );
  }
  const pct = (share: number) => `${Math.round(share * 100)}%`;
  return (
    <Text as="p" display="block" type="supporting" className="text-sm">
      Rated sure on {pct(calibration.overconfidence)} of {calibration.failedAnswered} puzzle
      {calibration.failedAnswered === 1 ? '' : 's'} whose latest drill failed
      {calibration.weekFailedAnswered > 0
        ? `, ${pct(calibration.weekOverconfidence)} in the last week`
        : ''}
      .
    </Text>
  );
}

/** The order the board reads in: reopened debts, running windows, paid debts. */
const STATE_ORDER: Record<PatternState['state'], number> = {
  came_back: 0,
  not_yet_verifiable: 1,
  candidate: 1,
  retired: 2,
  active: 1,
};

export function DebtBoard({
  stream,
  weaknesses = [],
}: {
  stream: Stream;
  /** The report's weaknesses, for the drill effort beside each balance. */
  weaknesses?: Weakness[];
}) {
  const query = useQuery(patternsQueryOptions(stream));
  if (query.isPending) {
    return (
      <div className="flex items-center gap-3 py-8">
        <Spinner />
        <Text as="p" display="block" type="supporting">
          Reading the debt board…
        </Text>
      </div>
    );
  }
  if (query.isError) {
    return (
      <EmptyState
        className="reveal-in"
        title="The debt board could not load"
        description="The rest of the report stands; the board reads its own endpoint and that read failed."
        headingLevel={2}
        actions={
          <Link onClick={() => void query.refetch()} className="min-h-11 items-center">
            Try again
          </Link>
        }
      />
    );
  }

  const { patterns, verificationFloor } = query.data;
  if (patterns.length === 0) {
    return (
      <section id="debt-board" className="reveal-in space-y-3">
        <Heading level={2}>Debt board</Heading>
        <EmptyState
          title="No debts on the board yet"
          description={`Drill a weakness to mastery and the board starts its verification window: ${verificationFloor} of your games without the pattern retires the debt.`}
          headingLevel={3}
        />
      </section>
    );
  }

  const drilledByGroup: Record<string, number> = Object.fromEntries(
    weaknesses
      .filter((w) => w.groupKey !== null)
      .map((w) => [`${w.kind}:${w.groupKey}`, w.drilled]),
  );
  const ordered = [...patterns].sort(
    (a, b) =>
      STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
      b.windowCost - a.windowCost ||
      a.label.localeCompare(b.label),
  );

  return (
    <section id="debt-board" className="reveal-in space-y-3">
      <Heading level={2}>Debt board</Heading>
      <Text as="p" display="block" type="supporting" className="text-sm">
        A balance falls only when your games verify the pattern is gone — {verificationFloor} window
        games without it. Puzzles never move it; that is the effort line beside the balance.
      </Text>
      <ol className="space-y-3">
        {ordered.map((pattern) => (
          <li key={`${pattern.kind}:${pattern.groupKey}`}>
            <DebtCard
              pattern={pattern}
              drilled={drilledByGroup[`${pattern.kind}:${pattern.groupKey}`] ?? null}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}
