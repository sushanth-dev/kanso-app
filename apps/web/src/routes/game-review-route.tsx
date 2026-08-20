import { useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import type { GameDetail, Mistake } from '../api/diagnosis-api.ts';
import { ParticleReveal } from '../components/canvas-ui/ParticleReveal.tsx';
import { Board } from '../components/board.tsx';
import { EvalBar, evalLabel } from '../components/eval-bar.tsx';
import { secondaryLinkClassName } from '../components/secondary-link.ts';
import { gameQueryOptions } from '../query-client.ts';

const JUDGEMENT_LABEL: Record<Mistake['judgement'], string> = {
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
};

const MOTIF_LABEL: Record<string, string> = {
  hanging_piece: 'Hung a piece',
  missed_check: 'Missed a check',
  missed_capture: 'Missed a capture',
  missed_threat: 'Missed a threat',
};

function GameSkeleton() {
  return (
    <div role="status" aria-label="Loading game review" aria-busy="true" className="space-y-4">
      <div className="h-8 w-48 rounded-control bg-sunken" />
      <div className="h-64 rounded-surface bg-sunken" />
      <div className="h-24 rounded-surface bg-sunken" />
    </div>
  );
}

export function GameReviewScreen({ game, playerId }: { game: GameDetail; playerId: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const mistakes = game.mistakes;
  const selected = mistakes.find((mistake) => mistake.id === selectedId) ?? mistakes[0];
  const opponent = game.playerColor === 'white' ? game.blackName : game.whiteName;

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <Link
          to="/account/players/$playerId/games"
          params={{ playerId }}
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
      </header>

      {selected === undefined ? (
        <Card className="p-6">
          <p className="text-muted">No recorded mistakes in this game.</p>
        </Card>
      ) : (
        <>
          <section aria-label="Position" className="space-y-4">
            <div className="flex max-w-md items-stretch gap-4">
              <EvalBar
                evaluation={selected.evalAfter}
                label={`Evaluation after move ${selected.moveNumber}: ${evalLabel(selected.evalAfter)}`}
              />
              <Board
                fen={selected.fen}
                from={game.plies.find((ply) => ply.ply === selected.ply)?.uci.slice(0, 2)}
                to={game.plies.find((ply) => ply.ply === selected.ply)?.uci.slice(2, 4)}
                flipped={selected.movingColor === 'black'}
                label={`Position before move ${selected.moveNumber}, ${selected.movingColor} to move`}
              />
            </div>
            <Card className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge label={JUDGEMENT_LABEL[selected.judgement]} variant="neutral" />
                <span className="font-mono text-sm text-muted">
                  -{(selected.cpLoss / 100).toFixed(1)} pawns
                </span>
              </div>
              <p>
                Move {selected.moveNumber}: you played{' '}
                <span className="font-mono">{selected.moveSan}</span>; best was{' '}
                <span className="font-mono">{selected.bestMoveSan}</span>.
              </p>
              <p className="font-mono text-sm text-muted">
                {evalLabel(selected.evalBefore)} → {evalLabel(selected.evalAfter)}
              </p>
              {selected.motif !== null ? (
                <p className="text-sm text-muted">
                  {MOTIF_LABEL[selected.motif] ?? selected.motif}
                </p>
              ) : null}
            </Card>
          </section>

          <section aria-labelledby="mistakes-heading">
            <Heading level={2} id="mistakes-heading">
              Mistakes in this game
            </Heading>
            <ol className="mt-3 space-y-2">
              {mistakes.map((mistake) => {
                const selectedState = mistake.id === selected.id;
                return (
                  <li key={mistake.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(mistake.id)}
                      aria-pressed={selectedState}
                      className={
                        selectedState
                          ? 'press w-full rounded-surface bg-raised p-3 text-left ring-2 ring-focus'
                          : 'press w-full rounded-surface bg-raised p-3 text-left hover:bg-sunken'
                      }
                    >
                      <span className="font-mono text-sm text-muted">
                        Move {mistake.moveNumber}
                      </span>
                      <span className="ml-3 font-mono">{mistake.moveSan}</span>
                      <span className="ml-3 text-sm text-muted">
                        {JUDGEMENT_LABEL[mistake.judgement]}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        </>
      )}
    </div>
  );
}

export function GameReviewRoute() {
  const { playerId, gameId } = useParams({
    from: '/account/players/$playerId/games/$gameId',
  });
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

  return <GameReviewScreen game={gameQuery.data} playerId={playerId} />;
}
