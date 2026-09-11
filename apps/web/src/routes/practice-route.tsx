/**
 * ST-106. The puzzle drill: one weakness group's set of 20 Lichess puzzles,
 * played the way the prototype's gym played them. The set is assembled by the
 * API before the route renders - the automatic flow the prototype reached by
 * polling its background job, reached here by an indexed query - so the drill
 * starts the moment the surface opens: the opponent's setup move plays
 * itself, the player finds the solution, three attempt circles cover three
 * tries, the third miss plays the solution and rotates the puzzle to the back
 * of the queue, and the session ends when the queue drains.
 *
 * The board is the review surface's board; the move input and the
 * never-committing wrong move are the practice mode's. What changed from
 * ST-101 is the material: puzzles from the pool, matched to the group, not
 * the player's own position back again.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Text } from '@astryxdesign/core/Text';
import { useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { Chess, type Square } from 'chess.js';
import { Board, describePosition } from '../components/board.tsx';
import { ApiRequestError } from '../api/account-api.ts';
import { diagnosisApi, type PracticePuzzle, type WeaknessKind } from '../api/diagnosis-api.ts';
import {
  patternsQueryOptions,
  practiceQueryOptions,
  practiceReviewsQueryOptions,
  reportQueryOptions,
} from '../query-client.ts';
import { DebtCard } from '../components/debt-board.tsx';
import { RetiredHeadline } from '../components/retired-headline.tsx';
import { drillHref, groupLabel } from './puzzles-route.tsx';

/** The attempts one puzzle allows before the reveal steps in. */
const ATTEMPTS = 3;
/** The pause before the setup move, between forced replies, and after a solve. */
const MOVE_PAUSE_MS = 600;
/** The pause after a reveal finishes before the puzzle rotates to the back. */
const ROTATE_PAUSE_MS = 1200;

/** One UCI string split the way chess.js wants it. */
function uciMove(uci: string): { from: string; to: string; promotion?: string } {
  const move = { from: uci.slice(0, 2), to: uci.slice(2, 4) };
  return uci.length > 4 ? { ...move, promotion: uci.slice(4, 5) } : move;
}

export function PracticeRoute() {
  const { kind, group, label, stream } = useSearch({ from: '/account/practice' });
  if (kind === null || group === null) {
    return (
      <div className="space-y-6">
        <RetiredHeadline streams={['tournament', 'online']} />
        <DueReviews />
      </div>
    );
  }
  return <PracticeScreen kind={kind} group={group} label={label ?? group} stream={stream} />;
}

/**
 * ST-124. The practice surface without a named weakness: the day's due
 * reviews. Solved drills return on the ladder, and the section serves at
 * most ten a day - the story's guard against review pressure. Each row
 * folds the group's due puzzles into one link, because the drill deals a
 * group's due puzzles before any fresh material.
 */
function DueReviews() {
  const noWeakness = (
    <EmptyState
      className="reveal-in"
      title="No weakness named"
      description="Open a weakness card in your report and choose its practice link."
      headingLevel={1}
      actions={
        <Link href="/report" className="min-h-11 items-center">
          Back to the report
        </Link>
      }
    />
  );
  const query = useQuery(practiceReviewsQueryOptions());
  if (query.isError) return noWeakness;
  if (query.isPending) {
    return (
      <div role="status" className="reveal-in flex items-center gap-3 py-16">
        <Spinner />
        <Text as="p" display="block" type="supporting">
          Checking what is due for review…
        </Text>
      </div>
    );
  }

  const { reviews, remaining } = query.data;
  if (reviews.length === 0) {
    if (remaining === 0) {
      return (
        <EmptyState
          className="reveal-in"
          title="Today's reviews are done"
          description="Ten due reviews is the day's cap, so the ladder cannot grind. Whatever is left comes back tomorrow."
          headingLevel={1}
          actions={
            <Link href="/report" className="min-h-11 items-center">
              Back to the report
            </Link>
          }
        />
      );
    }
    return noWeakness;
  }

  const groups = new Map<string, { kind: WeaknessKind; group: string; count: number }>();
  for (const review of reviews) {
    const key = `${review.kind}:${review.group}`;
    const row = groups.get(key);
    if (row) row.count += 1;
    else groups.set(key, { kind: review.kind, group: review.group, count: 1 });
  }
  return (
    <div className="space-y-4">
      <header className="reveal-in space-y-1">
        <Heading level={1}>Due for review</Heading>
        <Text as="p" display="block" type="supporting" className="text-sm">
          Solved drills come back on the ladder - two, seven, then thirty days.
        </Text>
      </header>
      <Card>
        <ul className="stagger-in">
          {[...groups.values()].map(({ kind: reviewKind, group: reviewGroup, count }) => (
            <li
              key={`${reviewKind}:${reviewGroup}`}
              className="flex items-center justify-between gap-3 border-b border-border-subtle py-3 last:border-b-0"
            >
              <Link href={drillHref(reviewKind, reviewGroup)} className="min-h-11 items-center">
                {groupLabel(reviewGroup)}
              </Link>
              <Badge label={count === 1 ? 'Due now' : `${count} due`} variant="warning" />
            </li>
          ))}
        </ul>
      </Card>
      <DrillSuggestions />
    </div>
  );
}

/**
 * ST-155. The drill budget on the practice surface: the report's weakness
 * groups reordered by recent, phase-weighted cost. The weighting is named in
 * the supporting line (AC#4) and the toggle offers the unweighted view, a
 * client-side re-sort over the same figures. The report read is cache-shared
 * with the report surface, so this costs no second fetch; the block stays
 * silent while that cache is cold rather than making the drill wait.
 */
function DrillSuggestions() {
  const [unweighted, setUnweighted] = useState(false);
  const reportQuery = useQuery({ ...reportQueryOptions('tournament'), staleTime: Infinity });
  if (reportQuery.isPending || reportQuery.isError) return null;
  const suggestions = reportQuery.data.drillSuggestions;
  if (suggestions.length === 0) return null;
  const ordered = unweighted
    ? [...suggestions].sort(
        (a, b) =>
          b.recentCost - a.recentCost ||
          a.kind.localeCompare(b.kind) ||
          a.groupKey.localeCompare(b.groupKey),
      )
    : suggestions;
  return (
    <section className="reveal-in space-y-2">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="space-y-1">
          <Heading level={2}>What to drill next</Heading>
          <Text as="p" display="block" type="supporting" className="text-sm">
            {unweighted
              ? 'Ordered by plain recent cost, no phase weighting.'
              : 'Ordered by recent mistakes against stronger opponents, in the phase losing you the most.'}
          </Text>
        </div>
        <Button
          label={unweighted ? 'Weighted view' : 'Unweighted view'}
          variant="ghost"
          className="min-h-11 press"
          aria-pressed={unweighted}
          onClick={() => setUnweighted((v) => !v)}
        />
      </header>
      <Card>
        <ul>
          {ordered.map((s) => (
            <li
              key={`${s.kind}:${s.groupKey}`}
              className="flex items-center justify-between gap-3 border-b border-border-subtle py-3 last:border-b-0"
            >
              <Link href={drillHref(s.kind, s.groupKey)} className="min-h-11 items-center">
                {s.label}
              </Link>
              <Text type="supporting" className="font-mono text-sm">
                {Math.round(s.recentCost * 10) / 10}
              </Text>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

/**
 * ST-152. The drill surface's debt card: the group's own row from the
 * patterns read, rendered by the board's card so the two surfaces cannot
 * drift. A group with no row has not started paying; the line says what
 * starts it. The drill never waits on this read - a pending or broken
 * board costs the drill nothing.
 */
export function PracticeDebtCard({
  kind,
  group,
  stream,
}: {
  kind: WeaknessKind;
  group: string;
  stream: 'tournament' | 'online';
}) {
  const patternsQuery = useQuery(patternsQueryOptions(stream));
  if (patternsQuery.isPending) return null;
  if (patternsQuery.isError) {
    return (
      <Text as="p" display="block" type="supporting" className="text-sm">
        The debt board could not load; the drill itself is unaffected.
      </Text>
    );
  }
  const pattern = patternsQuery.data.patterns.find((p) => p.kind === kind && p.groupKey === group);
  if (pattern === undefined) {
    return (
      <Text as="p" display="block" type="supporting" className="text-sm">
        Not on the debt board yet: drill the group to mastery and its verification window starts.
      </Text>
    );
  }
  return <DebtCard pattern={pattern} drilled={null} />;
}

export function PracticeScreen({
  kind,
  group,
  label,
  stream,
}: {
  kind: WeaknessKind;
  group: string;
  label: string;
  stream: 'tournament' | 'online';
}) {
  const query = useQuery(practiceQueryOptions(kind, group, stream));

  if (query.isPending) {
    return (
      <div role="status" className="reveal-in flex items-center gap-3 py-16">
        <Spinner />
        <Text as="p" display="block" type="supporting">
          Dealing 20 puzzles for {label}…
        </Text>
      </div>
    );
  }
  if (query.isError) {
    const status = query.error instanceof ApiRequestError ? query.error.status : null;
    return (
      <EmptyState
        className="reveal-in"
        title={status === 503 ? 'The puzzle pool is not ready' : 'This weakness has no drill'}
        description={
          status === 503
            ? 'The puzzle import has not run for this environment yet, so there is nothing to deal. Try again later.'
            : `No puzzle drill is mapped for ${label}.`
        }
        headingLevel={1}
        actions={
          <Link href={`/report?stream=${stream}`} className="min-h-11 items-center">
            Back to the report
          </Link>
        }
      />
    );
  }

  const set = query.data;
  return (
    <DrillSession
      key={`${kind}:${group}`}
      puzzles={set.puzzles}
      theme={set.theme}
      opening={set.opening}
      label={label}
      kind={kind}
      group={group}
      stream={stream}
    />
  );
}

/**
 * The queue and its progress. A solved puzzle leaves the queue; a revealed
 * one rotates to the back, the prototype's rule, so the session does not end
 * on the puzzles that taught the least. Recording a drill is log-and-continue
 * exactly as ST-102 recorded its drills: the session has already finished on
 * screen, and a broken-looking drill outweighs a missing tally.
 * ponytail: log-and-continue; queue retries if silent loss ever shows up.
 */
function DrillSession({
  puzzles,
  theme,
  opening,
  label,
  kind,
  group,
  stream,
}: {
  puzzles: PracticePuzzle[];
  theme: string;
  /** ST-122. The ECO family the opening rungs preferred, humanized; null on a theme deal. */
  opening: string | null;
  label: string;
  kind: WeaknessKind;
  group: string;
  stream: 'tournament' | 'online';
}) {
  const [queue, setQueue] = useState<PracticePuzzle[]>(puzzles);
  const [solvedCount, setSolvedCount] = useState(0);

  const advance = (
    puzzle: PracticePuzzle,
    solved: boolean,
    confidence: ConfidenceAnswer | null,
  ) => {
    if (solved) setSolvedCount((count) => count + 1);
    // ST-156. One record call carries the outcome and the pre-reveal
    // confidence; null (a skip) is omitted, absent from the arithmetic.
    diagnosisApi
      .recordPracticePuzzle({
        puzzleId: puzzle.id,
        kind,
        group,
        solved,
        ...(confidence !== null ? { confidence } : {}),
      })
      .catch((error: unknown) => {
        console.error('Recording the drill failed.', error);
      });
    setQueue((current) =>
      solved ? current.filter((p) => p.id !== puzzle.id) : [...current.slice(1), puzzle],
    );
  };

  if (queue.length === 0) {
    return (
      <EmptyState
        className="reveal-in"
        title="Drill complete"
        description={`${solvedCount} of ${puzzles.length} solved. Solved puzzles come back for review; the ones that fought back are due again today.`}
        headingLevel={1}
        actions={
          <>
            <Link href="/puzzles" className="min-h-11 items-center">
              See your puzzle queue
            </Link>
            <Link href={`/report?stream=${stream}`} className="min-h-11 items-center">
              Back to the report
            </Link>
          </>
        }
      />
    );
  }

  const current = queue[0]!;
  return (
    <div className="reveal-in space-y-4">
      <header className="space-y-1">
        <Heading level={1}>{label}</Heading>
        <PracticeDebtCard kind={kind} group={group} stream={stream} />
        <Text as="p" display="block" type="supporting" className="text-sm">
          {queue.length} puzzle{queue.length === 1 ? '' : 's'} to go, {solvedCount} solved. Theme:{' '}
          <span className="font-mono">{theme}</span>
          {opening === null ? '.' : `, from your ${opening}.`}
        </Text>
      </header>
      {/* The key gives every deal a fresh board and fresh circles. */}
      <DrillCard
        key={current.id}
        puzzle={current}
        onDone={(solved, confidence) => advance(current, solved, confidence)}
      />
    </div>
  );
}

/** One puzzle's status. `confidence` is ST-156's prompt at the commit boundary. */
type DrillStatus =
  'setup' | 'playing' | 'reply' | 'solved' | 'confidence' | 'revealing' | 'revealed';

/** The three answers the confidence prompt offers, plus a skip. */
type ConfidenceAnswer = 'sure' | 'not_sure' | 'guessed';

/**
 * One puzzle's lifecycle: the setup move plays itself, the player's correct
 * move advances the solution with the opponent's forced replies auto-played,
 * a wrong move never commits and costs one circle, and the third miss plays
 * the solution move by move before the puzzle rotates back. ST-156: at the
 * commit boundary - a solve before rotation, a third miss before the reveal
 * plays - one confidence question asks how sure the player was, and the
 * answer rides the drill's record call. Skipping is the prompt's third
 * option and records as absent.
 */
export function DrillCard({
  puzzle,
  onDone,
}: {
  puzzle: PracticePuzzle;
  onDone: (solved: boolean, confidence: ConfidenceAnswer | null) => void;
}) {
  const moves = useMemo(() => puzzle.moves.split(' '), [puzzle]);
  const setup = moves[0] ?? '';
  const solution = useMemo(() => moves.slice(1), [moves]);

  // The board starts at the pre-move FEN and plays the setup once.
  const [chess] = useState(() => new Chess(puzzle.fen));
  const [fen, setFen] = useState(puzzle.fen);
  const [status, setStatus] = useState<DrillStatus>('setup');
  const [attemptsLeft, setAttemptsLeft] = useState(ATTEMPTS);
  const [selected, setSelected] = useState<string | null>(null);
  const solutionIndex = useRef(0);
  const finished = useRef(false);
  // Whether the drill ended in a solve. The confidence prompt sits before
  // any reveal (AC2), so `revealing`/`revealed` never offer it and the
  // answer recorded is whatever was given before the solution showed.
  const endedSolved = useRef(false);

  // The solver is whoever is on the move after the setup move.
  const solverIsWhite = puzzle.fen.split(' ')[1] !== 'w';

  // One setup per puzzle: the effect reads the refs it needs at mount only.
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        chess.move(uciMove(setup));
      } catch {
        // The import validated this line plays; if it ever does not, the
        // next render still shows a position the player can read.
      }
      setFen(chess.fen());
      setStatus('playing');
    }, MOVE_PAUSE_MS);
    return () => clearTimeout(timer);
  }, []);

  // One completion per puzzle: report it, then let the queue move on. A
  // solve detours through the confidence prompt first; a reveal reports
  // immediately with no confidence, the boundary AC2 pins.
  useEffect(() => {
    if (status === 'solved') {
      endedSolved.current = true;
      const timer = setTimeout(() => setStatus('confidence'), MOVE_PAUSE_MS);
      return () => clearTimeout(timer);
    }
    if (status !== 'revealed') return;
    if (finished.current) return;
    finished.current = true;
    const timer = setTimeout(() => onDone(false, null), ROTATE_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [status]);

  // The prompt's answer or skip closes the drill: report it and rotate.
  const answerConfidence = (confidence: ConfidenceAnswer | null) => {
    if (finished.current) return;
    finished.current = true;
    onDone(endedSolved.current, confidence);
  };

  // A forced reply is due: play it, hand the move back to the player.
  useEffect(() => {
    if (status !== 'reply') return;
    const reply = solution[solutionIndex.current] ?? '';
    const timer = setTimeout(() => {
      try {
        chess.move(uciMove(reply));
      } catch {
        // The import validated this line plays.
      }
      solutionIndex.current += 1;
      setFen(chess.fen());
      setStatus('playing');
    }, MOVE_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [status]);

  // The reveal: play the rest of the solution, then explain the rotation.
  useEffect(() => {
    if (status !== 'revealing') return;
    const rest = solution.slice(solutionIndex.current);
    const timers = rest.map((uci, i) =>
      setTimeout(
        () => {
          try {
            chess.move(uciMove(uci));
          } catch {
            // The import validated this line plays.
          }
          solutionIndex.current += 1;
          setFen(chess.fen());
        },
        MOVE_PAUSE_MS * (i + 1),
      ),
    );
    timers.push(setTimeout(() => setStatus('revealed'), MOVE_PAUSE_MS * (rest.length + 1)));
    return () => timers.forEach(clearTimeout);
  }, [status]);

  const targets = useMemo<string[]>(
    () =>
      selected === null
        ? []
        : chess.moves({ square: selected as Square, verbose: true }).map((move) => move.to),
    [chess, selected, fen],
  );
  const movableSquares = useMemo(
    () =>
      status === 'playing'
        ? [...new Set(chess.moves({ verbose: true }).map((move) => move.from))]
        : [],
    [chess, fen, status],
  );

  const onSquareClick = (square: string) => {
    if (square === selected) {
      setSelected(null);
      return;
    }
    if (selected !== null && targets.includes(square)) {
      const candidate = chess
        .moves({ square: selected as Square, verbose: true })
        .find(
          (move) => move.to === square && (move.promotion === undefined || move.promotion === 'q'),
        );
      // The player's moves sit at the even indices of the solution; an
      // opponent's reply never counts as an attempted answer.
      const expected = solution[solutionIndex.current] ?? '';
      if (
        candidate !== undefined &&
        candidate.from === expected.slice(0, 2) &&
        candidate.to === expected.slice(2, 4)
      ) {
        chess.move({ from: candidate.from, to: candidate.to, promotion: candidate.promotion });
        setFen(chess.fen());
        solutionIndex.current += 1;
        setSelected(null);
        if (solution[solutionIndex.current] === undefined) {
          setStatus('solved');
        } else {
          setStatus('reply');
        }
      } else {
        const left = attemptsLeft - 1;
        setAttemptsLeft(left);
        setSelected(null);
        if (left === 0) setStatus('revealing');
      }
      return;
    }
    const piece = chess.get(square as Square);
    setSelected(piece !== undefined && piece.color === chess.turn() ? square : null);
  };

  const boardLabel = `Practice puzzle. ${describePosition(fen)}`;
  return (
    <div className="space-y-4">
      <div className="flex w-[480px] max-w-full items-stretch gap-4">
        <Board
          fen={fen}
          flipped={!solverIsWhite}
          selectedSquare={status === 'playing' ? (selected ?? undefined) : undefined}
          targetSquares={status === 'playing' ? targets : undefined}
          draggableSquares={status === 'playing' ? movableSquares : undefined}
          onSquareClick={status === 'playing' ? onSquareClick : undefined}
          label={boardLabel}
        />
      </div>
      <Card className="space-y-3 p-4">
        {status === 'playing' ? (
          <>
            <Heading level={3}>Find the best move.</Heading>
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="flex gap-1">
                {Array.from({ length: ATTEMPTS }, (_, pip) => (
                  <span
                    key={pip}
                    className={`block size-3 rounded-full border border-border-strong ${
                      pip < attemptsLeft ? 'bg-ink' : ''
                    }`}
                  />
                ))}
              </span>
              <Text type="supporting" className="text-sm">
                {attemptsLeft} {attemptsLeft === 1 ? 'attempt' : 'attempts'} left.
              </Text>
            </div>
            {attemptsLeft < ATTEMPTS ? (
              <Text as="p" display="block">
                Not the best move.
              </Text>
            ) : null}
          </>
        ) : null}
        {status === 'setup' || status === 'reply' ? (
          <Heading level={3}>
            {status === 'setup' ? 'Watch the setup move…' : 'The opponent replies…'}
          </Heading>
        ) : null}
        {status === 'solved' ? (
          /* The rare high-emotion moment: the solve verdict settles in on the
             delight budget instead of swapping as plain text. */
          <div className="pop-in space-y-3">
            <Heading level={3}>Solved.</Heading>
          </div>
        ) : null}
        {status === 'confidence' ? (
          /* ST-156. The commit boundary: the outcome is settled, the answer
             has not shown. One question, three answers, a skip. */
          <div className="space-y-3">
            <Heading level={3}>How sure were you?</Heading>
            <div className="flex flex-wrap gap-2">
              <Button
                label="Sure"
                variant="secondary"
                className="min-h-11 press"
                onClick={() => answerConfidence('sure')}
              />
              <Button
                label="Was not sure"
                variant="secondary"
                className="min-h-11 press"
                onClick={() => answerConfidence('not_sure')}
              />
              <Button
                label="Guessed"
                variant="secondary"
                className="min-h-11 press"
                onClick={() => answerConfidence('guessed')}
              />
              <Button
                label="Skip"
                variant="ghost"
                className="min-h-11 press"
                onClick={() => answerConfidence(null)}
              />
            </div>
          </div>
        ) : null}
        {status === 'revealing' || status === 'revealed' ? (
          <>
            <Heading level={3}>
              {status === 'revealing' ? 'The solution.' : 'Not this time.'}
            </Heading>
            <Text as="p" display="block" type="supporting">
              This one rotates to the back of the queue - you will see it again before the drill
              ends.
            </Text>
          </>
        ) : null}
      </Card>
    </div>
  );
}
