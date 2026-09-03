import { useEffect, useRef, useState } from 'react';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Text } from '@astryxdesign/core/Text';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { isActiveGame } from '../analysis-status.ts';
import { ApiRequestError } from '../api/account-api.ts';
import type { CctMove, GameDetail, Mistake, MovePly } from '../api/diagnosis-api.ts';
import { diagnosisApi } from '../api/diagnosis-api.ts';
import { UpgradePrompt } from '../components/upgrade-prompt.tsx';
import { ParticleReveal } from '../components/canvas-ui/ParticleReveal.tsx';
import { Board, describePosition } from '../components/board.tsx';
import { evalLabel } from '../components/eval-bar.tsx';
import {
  cctScanQueryOptions,
  explanationQueryOptions,
  gameQueryOptions,
  socraticQuestionQueryOptions,
} from '../query-client.ts';

const JUDGEMENT_LABEL: Record<Mistake['judgement'], string> = {
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
};

const JUDGEMENT_GLYPH: Record<Mistake['judgement'], string> = {
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
};

const MOTIF_LABEL: Record<string, string> = {
  hanging_piece: 'Hung a piece',
  missed_check: 'Missed a check',
  missed_capture: 'Missed a capture',
  missed_threat: 'Missed a threat',
};

/** The side to move at a ply's pre-move position, read off the FEN. */
function movingColorOf(ply: MovePly): 'white' | 'black' {
  return ply.fenBefore.split(' ')[1] === 'b' ? 'black' : 'white';
}

/** The name of the side that made a move, falling back to a generic label. */
function moverName(color: 'white' | 'black', game: GameDetail): string {
  return color === 'white' ? (game.whiteName ?? 'White') : (game.blackName ?? 'Black');
}

/**
 * The index into `plies` the review opens at: the deep-linked ply when one
 * arrives in the URL (ST-100), else the game's first recorded mistake, else
 * the start. An out-of-range or unknown ply falls through to the same
 * default rather than a blank board.
 */
function initialPlyIndex(game: GameDetail, targetPly: number | undefined): number {
  if (targetPly !== undefined) {
    const linked = game.plies.findIndex((ply) => ply.ply === targetPly);
    if (linked !== -1) return linked;
  }
  const firstMistake = game.mistakes[0];
  if (firstMistake === undefined) return 0;
  const index = game.plies.findIndex((ply) => ply.ply === firstMistake.ply);
  return index === -1 ? 0 : index;
}

interface MoveRow {
  moveNumber: number;
  white?: MovePly;
  black?: MovePly;
}

/** Pairs plies into White/Black rows by move number, for the notation panel. */
function toMoveRows(plies: MovePly[]): MoveRow[] {
  const rows: MoveRow[] = [];
  for (const ply of plies) {
    const moveNumber = Math.ceil(ply.ply / 2);
    let row = rows.at(-1);
    if (row === undefined || row.moveNumber !== moveNumber) {
      row = { moveNumber };
      rows.push(row);
    }
    if (ply.ply % 2 === 1) row.white = ply;
    else row.black = ply;
  }
  return rows;
}

function NotationMove({
  ply,
  mistake,
  isCurrent,
  onSelect,
}: {
  ply: MovePly;
  mistake: Mistake | undefined;
  isCurrent: boolean;
  onSelect: (ply: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(ply.ply)}
      aria-pressed={isCurrent}
      title={mistake === undefined ? undefined : JUDGEMENT_LABEL[mistake.judgement]}
      className={
        isCurrent
          ? 'press rounded-control bg-raised px-2 py-1 text-left font-mono text-sm ring-2 ring-focus'
          : 'press rounded-control px-2 py-1 text-left font-mono text-sm hover:bg-sunken'
      }
    >
      {ply.san}
      {mistake === undefined ? null : (
        <Text className="ml-1 text-danger">{JUDGEMENT_GLYPH[mistake.judgement]}</Text>
      )}
    </button>
  );
}

function Notation({
  plies,
  mistakes,
  currentPly,
  onSelect,
}: {
  plies: MovePly[];
  mistakes: Mistake[];
  currentPly: MovePly;
  onSelect: (ply: number) => void;
}) {
  const mistakeByPly = new Map(mistakes.map((mistake) => [mistake.ply, mistake]));
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const current = listRef.current?.querySelector('[aria-pressed="true"]');
    current?.scrollIntoView?.({ block: 'nearest' });
  }, [currentPly.ply]);
  return (
    <section
      aria-labelledby="notation-heading"
      className="flex h-[480px] w-56 shrink-0 flex-col rounded-surface border border-border-strong p-4"
    >
      <Heading level={2} id="notation-heading">
        Moves
      </Heading>
      <ol
        ref={listRef}
        className="mt-3 grid flex-1 grid-cols-[auto_1fr_1fr] items-start gap-x-2 gap-y-1 overflow-y-auto py-1 pr-1"
      >
        {toMoveRows(plies).map((row) => (
          <li key={row.moveNumber} className="contents">
            <Text type="supporting" className="font-mono text-sm">
              {row.moveNumber}.
            </Text>
            {row.white === undefined ? (
              <span />
            ) : (
              <NotationMove
                ply={row.white}
                mistake={mistakeByPly.get(row.white.ply)}
                isCurrent={row.white.ply === currentPly.ply}
                onSelect={onSelect}
              />
            )}
            {row.black === undefined ? (
              <span />
            ) : (
              <NotationMove
                ply={row.black}
                mistake={mistakeByPly.get(row.black.ply)}
                isCurrent={row.black.ply === currentPly.ply}
                onSelect={onSelect}
              />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** "won", "lost" or "drew" from the player's side, or null when neither is known. */
function resultGloss(
  result: GameDetail['result'],
  playerColor: GameDetail['playerColor'],
): 'won' | 'lost' | 'drew' | null {
  if (result === '1/2-1/2') return 'drew';
  if (playerColor === null) return null;
  if (result === '1-0') return playerColor === 'white' ? 'won' : 'lost';
  if (result === '0-1') return playerColor === 'black' ? 'won' : 'lost';
  return null;
}

const CCT_GROUP_LABEL: Record<'checks' | 'captures' | 'threats', string> = {
  checks: 'Checks',
  captures: 'Captures',
  threats: 'Threats',
};

function CctMoveList({ label, moves }: { label: string; moves: CctMove[] }) {
  if (moves.length === 0) return null;
  return (
    <div>
      <Heading level={3} className="text-sm font-semibold">
        {label}
      </Heading>
      <ul className="mt-1 flex flex-wrap gap-2">
        {moves.map((move) => (
          <li key={move.san}>
            <Badge label={move.san} variant={move.isGoodOption ? 'info' : 'neutral'} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** ST-080. The checks, captures and threats available at the mistake position. */
function CctScanCard({ mistakeId }: { mistakeId: string }) {
  const scanQuery = useQuery(cctScanQueryOptions(mistakeId));

  return (
    <Card className="space-y-3 p-4">
      <Heading level={3}>CCT scan</Heading>
      {scanQuery.isPending ? (
        <Text as="p" display="block" type="supporting" className="text-sm">
          Scanning the position…
        </Text>
      ) : scanQuery.isError ? (
        <Text as="p" display="block" type="supporting" className="text-sm">
          The scan could not be loaded.
        </Text>
      ) : scanQuery.data.checks.length === 0 &&
        scanQuery.data.captures.length === 0 &&
        scanQuery.data.threats.length === 0 ? (
        <Text as="p" display="block" type="supporting" className="text-sm">
          No checks, captures or threats at this position.
        </Text>
      ) : (
        <>
          <CctMoveList label={CCT_GROUP_LABEL.checks} moves={scanQuery.data.checks} />
          <CctMoveList label={CCT_GROUP_LABEL.captures} moves={scanQuery.data.captures} />
          <CctMoveList label={CCT_GROUP_LABEL.threats} moves={scanQuery.data.threats} />
        </>
      )}
    </Card>
  );
}

/** ST-080. AI explanation and Socratic question for the mistake, per ADR-0018. */
function ExplanationCard({ mistakeId }: { mistakeId: string }) {
  const explanationQuery = useQuery(explanationQueryOptions(mistakeId));
  const questionQuery = useQuery(socraticQuestionQueryOptions(mistakeId));

  return (
    <Card className="space-y-3 p-4">
      <Heading level={3}>Coach's take</Heading>
      {explanationQuery.isError ? (
        explanationQuery.error instanceof ApiRequestError &&
        explanationQuery.error.code === 'upgrade_required' ? (
          <UpgradePrompt
            title="You have used this month's coach explanations"
            body="The coach's take is part of your plan: 50 explanations a month on Beginner, 100 on Intermediate, unlimited on Pro. Texts you already have stay free to re-read."
          />
        ) : (
          <Text as="p" display="block" type="supporting" className="text-sm">
            The explanation could not be loaded.
          </Text>
        )
      ) : (
        <Text as="p" display="block" className="text-sm">
          {explanationQuery.data?.text ?? 'Working out what happened here…'}
        </Text>
      )}
      {questionQuery.isError ? null : (
        <Text as="p" display="block" type="supporting" className="text-sm">
          {questionQuery.data?.question ?? 'Thinking of a question to ask you…'}
        </Text>
      )}
    </Card>
  );
}

/** The colour dot beside the board: the player's side, or neutral when unset. */
function PlayerColorDot({ playerColor }: { playerColor: GameDetail['playerColor'] }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <span
        aria-label={
          playerColor === null ? 'Your colour is not set for this game' : `You play ${playerColor}`
        }
        role="img"
        className={`block size-5 rounded-full border border-border-strong ${
          playerColor === 'white' ? 'bg-white' : playerColor === 'black' ? 'bg-ink' : 'bg-sunken'
        }`}
      />
    </div>
  );
}

function GameSkeleton() {
  return (
    <div role="status" aria-label="Loading game review" aria-busy="true" className="space-y-4">
      <div className="h-8 w-48 rounded-control bg-sunken" />
      <div className="h-64 rounded-surface bg-sunken" />
      <div className="h-24 rounded-surface bg-sunken" />
    </div>
  );
}

export function GameReviewScreen({
  game,
  targetPly,
}: {
  game: GameDetail;
  /** ST-100. The ply a report evidence link deep-links to; undefined otherwise. */
  targetPly?: number;
}) {
  const [plyIndex, setPlyIndex] = useState(() => initialPlyIndex(game, targetPly));
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [colorError, setColorError] = useState<string | null>(null);
  // Default the board to the player's own colour at the bottom; the player can
  // flip it manually rather than the board auto-flipping to the side to move.
  const [flipped, setFlipped] = useState(() => game.playerColor === 'black');

  // When the player sets their colour (the game starts undecided), orient the
  // board to their side. A manual flip is left alone while the colour is still
  // unknown.
  useEffect(() => {
    if (game.playerColor !== null) setFlipped(game.playerColor === 'black');
  }, [game.playerColor]);

  const deleteMutation = useMutation({
    mutationFn: () => diagnosisApi.deleteGame(game.id),
  });

  const setColorMutation = useMutation({
    mutationFn: (playerColor: 'white' | 'black') => diagnosisApi.setGameColor(game.id, playerColor),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['game', game.id] });
      void queryClient.invalidateQueries({ queryKey: ['games'] });
    },
  });

  const onSetColor = (playerColor: 'white' | 'black') => {
    setColorError(null);
    setColorMutation.mutate(playerColor, {
      onError: () => setColorError('Your colour could not be saved. Please try again.'),
    });
  };

  const onConfirmDelete = async () => {
    setDeleteError(null);
    try {
      await deleteMutation.mutateAsync();
      setIsDeleteOpen(false);
      await navigate({ to: '/games', search: { stream: game.stream } });
      void queryClient.invalidateQueries({ queryKey: ['games', game.stream] });
    } catch {
      setDeleteError('The game could not be deleted. Please try again.');
    }
  };
  const gloss = resultGloss(game.result, game.playerColor);
  const currentPly = game.plies[plyIndex];
  const currentMistake = game.mistakes.find((mistake) => mistake.ply === currentPly?.ply);

  // ST-106. The drill this mistake feeds: its motif when one was attributed,
  // else the phase, because the theme map knows both kinds. A mistake with
  // neither has no drill to offer.
  const drillEntry =
    currentMistake === undefined
      ? null
      : currentMistake.motif !== null
        ? {
            kind: 'motif' as const,
            group: currentMistake.motif,
            label: MOTIF_LABEL[currentMistake.motif] ?? currentMistake.motif,
          }
        : currentMistake.phase !== null
          ? {
              kind: 'phase' as const,
              group: currentMistake.phase,
              label: currentMistake.phase.charAt(0).toUpperCase() + currentMistake.phase.slice(1),
            }
          : null;
  const stepBy = (delta: number) => {
    setPlyIndex((index) => Math.min(Math.max(index + delta, 0), game.plies.length - 1));
  };
  const selectPly = (ply: number) => {
    const index = game.plies.findIndex((movePly) => movePly.ply === ply);
    if (index !== -1) setPlyIndex(index);
  };

  useEffect(() => {
    if (game.plies.length === 0) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        stepBy(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        stepBy(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setPlyIndex(0);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setPlyIndex(game.plies.length - 1);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [game.plies.length]);

  // The review's own transport; no practice mode pauses it any more.
  const stepControls = (
    <div className="flex items-center gap-2">
      <Button
        label="Previous move"
        variant="secondary"
        isDisabled={plyIndex === 0}
        onClick={() => stepBy(-1)}
      />
      <Button
        label="Next move"
        variant="secondary"
        isDisabled={plyIndex === game.plies.length - 1}
        onClick={() => stepBy(1)}
      />
      <Button
        label="Flip board"
        variant="secondary"
        onClick={() => setFlipped((value) => !value)}
      />
      <Text type="supporting" className="font-mono text-sm">
        Move {Math.ceil((plyIndex + 1) / 2)} of {Math.ceil(game.plies.length / 2)}
      </Text>
    </div>
  );
  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button label="Back to games" href={`/games?stream=${game.stream}`} variant="secondary" />
          <Button label="Delete game" variant="destructive" onClick={() => setIsDeleteOpen(true)} />
        </div>
        <Heading level={1}>Game review</Heading>
        <Text as="p" display="block" type="supporting">
          {game.whiteName ?? 'Unknown'} vs {game.blackName ?? 'Unknown'}
        </Text>
        {/* The result reveal is the Canvas UI effect ADR-0017 names. The
            background is the Study Room page colour, so the shader can tell
            text apart from empty space; the token's value, since the vendored
            engine takes a concrete CSS colour. */}
        <ParticleReveal background="#f7f2ea" className="max-w-fit">
          <Text className="font-mono text-lg text-primary">{game.result}</Text>
        </ParticleReveal>
        {gloss !== null ? (
          <Text as="p" display="block">
            You {gloss}.
          </Text>
        ) : null}
        {game.playerColor === null ? (
          <div className="space-y-2">
            <Text as="p" display="block" type="supporting">
              Your side was not recorded for this game. Which colour were you?
            </Text>
            <div className="flex flex-wrap gap-2">
              <Button
                label="I was White"
                variant="secondary"
                onClick={() => onSetColor('white')}
                isDisabled={setColorMutation.isPending}
                className="press"
              />
              <Button
                label="I was Black"
                variant="secondary"
                onClick={() => onSetColor('black')}
                isDisabled={setColorMutation.isPending}
                className="press"
              />
            </div>
            {colorError !== null ? (
              <Text as="p" display="block" type="supporting" className="text-danger">
                {colorError}
              </Text>
            ) : null}
          </div>
        ) : null}
        <AlertDialog
          isOpen={isDeleteOpen}
          onOpenChange={setIsDeleteOpen}
          title="Delete this game?"
          description="This removes the game and its analysis. This cannot be undone."
          actionLabel="Delete"
          isActionLoading={deleteMutation.isPending}
          onAction={() => {
            void onConfirmDelete();
          }}
        />
        {deleteError !== null ? (
          <Text as="p" display="block" type="supporting" className="text-danger">
            {deleteError}
          </Text>
        ) : null}
      </header>

      {isActiveGame(game) ? <GameAnalysing /> : null}
      {currentPly === undefined ? (
        <Card className="p-6">
          <Text as="p" display="block" type="supporting">
            No recorded moves in this game.
          </Text>
        </Card>
      ) : (
        <>
          <section aria-label="Position" className="space-y-4">
            <div className="flex flex-wrap items-start gap-6">
              <div className="flex w-[480px] max-w-full items-stretch gap-4">
                <Board
                  fen={currentPly.fenBefore}
                  from={currentPly.uci.slice(0, 2)}
                  to={currentPly.uci.slice(2, 4)}
                  bestFrom={currentPly.bestMoveUci?.slice(0, 2)}
                  bestTo={currentPly.bestMoveUci?.slice(2, 4)}
                  flipped={flipped}
                  label={`Position before move ${Math.ceil(currentPly.ply / 2)}, ${movingColorOf(currentPly)} to move. ${describePosition(currentPly.fenBefore)}`}
                />
                <PlayerColorDot playerColor={game.playerColor} />
              </div>

              <Notation
                plies={game.plies}
                mistakes={game.mistakes}
                currentPly={currentPly}
                onSelect={selectPly}
              />
            </div>

            {stepControls}

            {currentMistake === undefined ? (
              <Card className="space-y-2">
                <Text as="p" display="block">
                  Move {Math.ceil(currentPly.ply / 2)}:{' '}
                  {movingColorOf(currentPly) === game.playerColor ? (
                    <>
                      you played <span className="font-mono">{currentPly.san}</span>.
                    </>
                  ) : (
                    <>
                      {moverName(movingColorOf(currentPly), game)} played{' '}
                      <span className="font-mono">{currentPly.san}</span>.
                    </>
                  )}
                </Text>
                <Text as="p" display="block" type="supporting" className="font-mono text-sm">
                  Advantage: {evalLabel(currentPly.evaluation)}
                </Text>
              </Card>
            ) : (
              <Card className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge label={JUDGEMENT_LABEL[currentMistake.judgement]} variant="neutral" />
                  <Text type="supporting" className="font-mono text-sm">
                    -{(currentMistake.cpLoss / 100).toFixed(1)} pawns
                  </Text>
                </div>
                <Text as="p" display="block">
                  Move {currentMistake.moveNumber}:{' '}
                  {currentMistake.movingColor === game.playerColor ? (
                    <>
                      you played <span className="font-mono">{currentMistake.moveSan}</span>; best
                      was <span className="font-mono">{currentMistake.bestMoveSan}</span>.
                    </>
                  ) : (
                    <>
                      {moverName(currentMistake.movingColor, game)} played{' '}
                      <span className="font-mono">{currentMistake.moveSan}</span>; best was{' '}
                      <span className="font-mono">{currentMistake.bestMoveSan}</span>.
                    </>
                  )}
                </Text>
                <Text as="p" display="block" type="supporting" className="font-mono text-sm">
                  Advantage: {evalLabel(currentMistake.evalBefore)} →{' '}
                  {evalLabel(currentMistake.evalAfter)}
                </Text>
                {currentMistake.motif !== null ? (
                  <Text as="p" display="block" type="supporting" className="text-sm">
                    {MOTIF_LABEL[currentMistake.motif] ?? currentMistake.motif}
                  </Text>
                ) : null}
                {drillEntry !== null ? (
                  <Link
                    href={`/practice?kind=${drillEntry.kind}&group=${encodeURIComponent(drillEntry.group)}&label=${encodeURIComponent(drillEntry.label)}&stream=${game.stream}`}
                  >
                    Drill this pattern
                  </Link>
                ) : null}
              </Card>
            )}
            {currentMistake !== undefined ? (
              <>
                <ExplanationCard mistakeId={currentMistake.id} />
                <CctScanCard mistakeId={currentMistake.id} />
              </>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}

/** ST-096. The engine is still working on this game; the review fills in when it lands. */
function GameAnalysing() {
  return (
    <div
      role="status"
      aria-label="Analysing game"
      className="flex items-center gap-3 rounded-surface border border-border-strong bg-raised px-4 py-3"
    >
      <Spinner size="sm" />
      <Text as="p" display="block" className="text-sm text-primary">
        Analysing this game. The mistakes and evaluations appear here as soon as it finishes.
      </Text>
    </div>
  );
}

export function GameReviewRoute() {
  const { gameId } = useParams({ from: '/account/games/$gameId' });
  // ST-100. The ply a report evidence link deep-links to; absent on a plain
  // navigation, which leaves the first-mistake default in place.
  const { ply } = useSearch({ from: '/account/games/$gameId' });
  // The pathless account layout means the route id is /account/games/$gameId
  // but the navigation path is /games/$gameId.
  const gameQuery = useQuery({
    ...gameQueryOptions(gameId),
    refetchInterval: (query) =>
      query.state.data !== undefined && isActiveGame(query.state.data) ? 5000 : false,
  });

  if (gameQuery.isPending) return <GameSkeleton />;

  if (gameQuery.isError) {
    return (
      <EmptyState
        title="This game could not be loaded"
        description="Go back and try again."
        headingLevel={2}
      />
    );
  }

  return <GameReviewScreen game={gameQuery.data} targetPly={ply} />;
}
