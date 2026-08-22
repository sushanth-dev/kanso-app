import { useEffect, useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import type { CctMove, GameDetail, Mistake, MovePly } from '../api/diagnosis-api.ts';
import { ParticleReveal } from '../components/canvas-ui/ParticleReveal.tsx';
import { Board, describePosition } from '../components/board.tsx';
import { EvalBar, evalLabel } from '../components/eval-bar.tsx';
import { secondaryLinkClassName } from '../components/secondary-link.ts';
import { cctScanQueryOptions, gameQueryOptions } from '../query-client.ts';

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

/** The index into `plies` for the game's first recorded mistake, else 0. */
function initialPlyIndex(game: GameDetail): number {
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
        <span className="ml-1 text-danger">{JUDGEMENT_GLYPH[mistake.judgement]}</span>
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
  return (
    <section aria-labelledby="notation-heading">
      <Heading level={2} id="notation-heading">
        Moves
      </Heading>
      <ol className="mt-3 grid grid-cols-[auto_1fr_1fr] items-center gap-x-2 gap-y-1">
        {toMoveRows(plies).map((row) => (
          <li key={row.moveNumber} className="contents">
            <span className="font-mono text-sm text-muted">{row.moveNumber}.</span>
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
      <h3 className="text-sm font-semibold text-muted">{label}</h3>
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
        <p className="text-sm text-muted">Scanning the position…</p>
      ) : scanQuery.isError ? (
        <p className="text-sm text-muted">The scan could not be loaded.</p>
      ) : scanQuery.data.checks.length === 0 &&
        scanQuery.data.captures.length === 0 &&
        scanQuery.data.threats.length === 0 ? (
        <p className="text-sm text-muted">No checks, captures or threats at this position.</p>
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

function GameSkeleton() {
  return (
    <div role="status" aria-label="Loading game review" aria-busy="true" className="space-y-4">
      <div className="h-8 w-48 rounded-control bg-sunken" />
      <div className="h-64 rounded-surface bg-sunken" />
      <div className="h-24 rounded-surface bg-sunken" />
    </div>
  );
}

export function GameReviewScreen({ game }: { game: GameDetail }) {
  const [plyIndex, setPlyIndex] = useState(() => initialPlyIndex(game));
  const opponent = game.playerColor === 'white' ? game.blackName : game.whiteName;
  const gloss = resultGloss(game.result, game.playerColor);
  const currentPly = game.plies[plyIndex];
  const currentMistake = game.mistakes.find((mistake) => mistake.ply === currentPly?.ply);

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
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [game.plies.length]);

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <Link
          to="/account/games"
          search={{ stream: game.stream }}
          className={secondaryLinkClassName}
        >
          Back to games
        </Link>
        <Heading level={1}>Game review</Heading>
        <p className="text-muted">{opponent ? `vs ${opponent}` : 'Opponent unknown'}</p>
        {/* The result reveal is the Canvas UI effect ADR-0017 names. The
            background is the Study Room page colour, so the shader can tell
            text apart from empty space; the token's value, since the vendored
            engine takes a concrete CSS colour. */}
        <ParticleReveal background="#f7f2ea" className="max-w-fit">
          <span className="font-mono text-lg text-primary">{game.result}</span>
        </ParticleReveal>
        {gloss !== null ? <p>You {gloss}.</p> : null}
      </header>

      {currentPly === undefined ? (
        <Card className="p-6">
          <p className="text-muted">No recorded moves in this game.</p>
        </Card>
      ) : (
        <>
          <section aria-label="Position" className="space-y-4">
            <div className="flex max-w-md items-stretch gap-4">
              <EvalBar
                evaluation={
                  currentMistake === undefined ? currentPly.evaluation : currentMistake.evalAfter
                }
                label={`White's advantage: ${evalLabel(currentMistake === undefined ? currentPly.evaluation : currentMistake.evalAfter)}`}
              />
              <Board
                fen={currentPly.fenBefore}
                from={currentPly.uci.slice(0, 2)}
                to={currentPly.uci.slice(2, 4)}
                bestFrom={currentPly.bestMoveUci?.slice(0, 2)}
                bestTo={currentPly.bestMoveUci?.slice(2, 4)}
                flipped={movingColorOf(currentPly) === 'black'}
                label={`Position before move ${Math.ceil(currentPly.ply / 2)}, ${movingColorOf(currentPly)} to move. ${describePosition(currentPly.fenBefore)}`}
              />
            </div>

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
              <span className="font-mono text-sm text-muted">
                Move {plyIndex + 1} of {game.plies.length}
              </span>
            </div>

            {currentMistake === undefined ? (
              <Card className="space-y-2">
                <p>
                  Move {Math.ceil(currentPly.ply / 2)}: you played{' '}
                  <span className="font-mono">{currentPly.san}</span>.
                </p>
                <p className="font-mono text-sm text-muted">
                  White's advantage: {evalLabel(currentPly.evaluation)}
                </p>
              </Card>
            ) : (
              <Card className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge label={JUDGEMENT_LABEL[currentMistake.judgement]} variant="neutral" />
                  <span className="font-mono text-sm text-muted">
                    -{(currentMistake.cpLoss / 100).toFixed(1)} pawns
                  </span>
                </div>
                <p>
                  Move {currentMistake.moveNumber}: you played{' '}
                  <span className="font-mono">{currentMistake.moveSan}</span>; best was{' '}
                  <span className="font-mono">{currentMistake.bestMoveSan}</span>.
                </p>
                <p className="font-mono text-sm text-muted">
                  White's advantage: {evalLabel(currentMistake.evalBefore)} →{' '}
                  {evalLabel(currentMistake.evalAfter)}
                </p>
                {currentMistake.motif !== null ? (
                  <p className="text-sm text-muted">
                    {MOTIF_LABEL[currentMistake.motif] ?? currentMistake.motif}
                  </p>
                ) : null}
              </Card>
            )}
            {currentMistake !== undefined ? (
              <CctScanCard mistakeId={currentMistake.id} />
            ) : null}
          </section>

          <Notation
            plies={game.plies}
            mistakes={game.mistakes}
            currentPly={currentPly}
            onSelect={selectPly}
          />
        </>
      )}
    </div>
  );
}

export function GameReviewRoute() {
  const { gameId } = useParams({ from: '/account/games/$gameId' });
  const gameQuery = useQuery(gameQueryOptions(gameId));

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

  return <GameReviewScreen game={gameQuery.data} />;
}
