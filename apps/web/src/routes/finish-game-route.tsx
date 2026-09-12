/**
 * ST-158. Finish your own game from the mistake forward.
 *
 * The session opens at the mistake position, the game so far behind it. The
 * opponent's stored replies play themselves while the player stays on the
 * game's rails; the moment they play a move off the rails, the endpoint
 * answers - a depth-capped search over the position their own game actually
 * reached. The session ends at mate, a draw, the real game's own end, or the
 * stop button; nothing it does touches the streak, the verdicts, or the
 * pattern state (the ST-129 practice-only rule).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Text } from '@astryxdesign/core/Text';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Chess } from 'chess.js';
import { finishGameApi } from '../api/finish-game-api.ts';
import type { GameDetail } from '../api/diagnosis-api.ts';
import { gameQueryOptions } from '../query-client.ts';
import { Board, describePosition } from '../components/board.tsx';
import { resultGloss } from '../components/review-pieces.tsx';

/** The pause between the auto-played rail moves, the drill's own cadence. */
const MOVE_PAUSE_MS = 600;

/** One UCI string split the way chess.js wants it. */
function uciMove(uci: string): { from: string; to: string; promotion?: string } {
  const move = { from: uci.slice(0, 2), to: uci.slice(2, 4) };
  return uci.length > 4 ? { ...move, promotion: uci.slice(4, 5) } : move;
}

/** One entry of the session's move log, on or off the rails. */
interface SessionPly {
  ply: number;
  san: string;
  uci: string;
  /** False once the player has left the game's stored tree. */
  onRails: boolean;
}

/**
 * The state machine the session walks: the player's turn (which also covers
 * the pause while a stored rail reply is about to play), waiting on the
 * server, or finished.
 */
type SessionStatus = 'playing' | 'thinking' | 'over';

export function FinishGameScreen({ game, mistakePly }: { game: GameDetail; mistakePly: number }) {
  const navigate = useNavigate();
  // The deep-linked ply is a report or review link's claim; an unknown one
  // lands on the game's first recorded mistake, the review's own default.
  const startPly = game.mistakes.some((candidate) => candidate.ply === mistakePly)
    ? mistakePly
    : (game.mistakes[0]?.ply ?? 0);
  const mistake = game.mistakes.find((candidate) => candidate.ply === startPly);
  const playerIsWhite = game.playerColor !== 'black';

  // The session opens where the mistake was made: every stored ply before it
  // is already on the board, the mistake move itself is the first rail.
  const [chess] = useState(() => {
    const position = new Chess();
    for (const movePly of game.plies) {
      if (movePly.ply >= startPly) break;
      try {
        position.move(movePly.san);
      } catch {
        break;
      }
    }
    return position;
  });
  const [fen, setFen] = useState(chess.fen());
  const [sessionPlies, setSessionPlies] = useState<SessionPly[]>(() =>
    game.plies
      .filter((movePly) => movePly.ply < startPly)
      .map((movePly) => ({
        ply: movePly.ply,
        san: movePly.san,
        uci: movePly.uci,
        onRails: true,
      })),
  );
  const [rails, setRails] = useState<SessionPly[]>(() =>
    game.plies
      .filter((movePly) => movePly.ply >= startPly)
      .map((movePly) => ({
        ply: movePly.ply,
        san: movePly.san,
        uci: movePly.uci,
        onRails: true,
      })),
  );
  const [status, setStatus] = useState<SessionStatus>('playing');
  const [outcome, setOutcome] = useState<string | null>(null);
  const [endpointError, setEndpointError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const playerTurn = (chess.turn() === 'w') === playerIsWhite;

  const targetSquares = useMemo<string[]>(
    () =>
      selected === null
        ? []
        : chess.moves({ square: selected as never, verbose: true }).map((move) => move.to),
    [chess, selected, fen],
  );
  const movableSquares = useMemo(
    () =>
      status === 'playing' && playerTurn
        ? [...new Set(chess.moves({ verbose: true }).map((move) => move.from))]
        : [],
    [chess, fen, status, playerTurn],
  );

  const finish = useCallback((text: string) => {
    setOutcome(text);
    setStatus('over');
  }, []);

  // The board reading, run after every commit to the position. `rest` is what
  // remains of the rails, or null once the session is off them: the real
  // game's own end is only the session's end while the moves are still the
  // game's own.
  const readPosition = useCallback(
    (rest: SessionPly[] | null) => {
      setFen(chess.fen());
      if (chess.isCheckmate()) {
        finish(`${chess.turn() === 'w' ? 'Black' : 'White'} wins by checkmate.`);
        return;
      }
      if (chess.isDraw()) {
        finish('The game is drawn.');
        return;
      }
      if (rest !== null && rest.length === 0) {
        const gloss = resultGloss(game.result, game.playerColor);
        finish(gloss === null ? 'The real game ended here.' : `The real game: ${gloss}.`);
      }
    },
    [chess, finish, game.result, game.playerColor],
  );

  // The stored continuation plays itself, one ply per tick, whenever the
  // position sits on the rails at the opponent's turn. The player's turn
  // hands control over; no rails at the opponent's turn asks the endpoint.
  useEffect(() => {
    if (status !== 'playing') return;
    if (playerTurn) return;
    if (rails.length === 0) {
      setStatus('thinking');
      return;
    }
    const next = rails[0]!;
    const timer = setTimeout(() => {
      try {
        chess.move(uciMove(next.uci));
      } catch {
        // A stored ply that does not play is skipped, not fatal.
        setRails((current) => current.slice(1));
        return;
      }
      setSessionPlies((current) => [...current, next]);
      setRails((current) => current.slice(1));
      readPosition(rails.slice(1));
    }, MOVE_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [status, rails, chess, playerTurn, readPosition]);

  const onSquareClick = (square: string) => {
    if (status !== 'playing' || !playerTurn) return;
    if (square === selected) {
      setSelected(null);
      return;
    }
    if (selected !== null && targetSquares.includes(square)) {
      const candidate = chess
        .moves({ square: selected as never, verbose: true })
        .find(
          (move) => move.to === square && (move.promotion === undefined || move.promotion === 'q'),
        );
      setSelected(null);
      if (candidate === undefined) return;
      const expected = rails[0];
      if (
        expected !== undefined &&
        candidate.from === expected.uci.slice(0, 2) &&
        candidate.to === expected.uci.slice(2, 4)
      ) {
        // On the rails: the stored continuation applies, no engine call.
        chess.move({ from: candidate.from, to: candidate.to, promotion: candidate.promotion });
        setSessionPlies((current) => [...current, expected]);
        setRails((current) => current.slice(1));
        readPosition(rails.slice(1));
        return;
      }
      // Off the rails: commit the player's move, then ask the server for the
      // opponent's answer over the position their own game reached.
      chess.move({ from: candidate.from, to: candidate.to, promotion: candidate.promotion });
      const playedUci = `${candidate.from}${candidate.to}${candidate.promotion ?? ''}`;
      setSessionPlies((current) => [
        ...current,
        {
          ply: (current[current.length - 1]?.ply ?? 0) + 1,
          san: candidate.san,
          uci: playedUci,
          onRails: false,
        },
      ]);
      setRails([]);
      readPosition(null);
      setStatus((current) => (current === 'over' ? current : 'thinking'));
      return;
    }
    const piece = chess.get(square as never);
    setSelected(piece !== undefined && piece.color === chess.turn() ? square : null);
  };

  // The thinking state resolves into the engine's reply or an error that
  // hands the move back. `sessionPlies` is read once per turn; the effect
  // keys on the state, not on every log append.
  useEffect(() => {
    if (status !== 'thinking') return;
    let cancelled = false;
    // Every session ply from the mistake on, rails and deviations alike: the
    // server rebuilds the position as the stored plies to `railPly` plus this
    // list, so anything played since the mistake has to be in it. The plies
    // before the mistake are already covered by `railPly`.
    const sinceStart = sessionPlies
      .filter((entry) => entry.ply >= startPly)
      .map((entry) => entry.san);
    const run = async () => {
      try {
        const reply = await finishGameApi.engineReply(game.id, {
          railPly: startPly - 1,
          playerMoves: sinceStart,
        });
        if (cancelled) return;
        setEndpointError(null);
        if (reply.status === 'game_over' || reply.move === null) {
          const gloss = resultGloss(game.result, game.playerColor);
          finish(gloss === null ? 'The real game ended here.' : `The real game: ${gloss}.`);
          return;
        }
        const replyMove = reply.move;
        chess.move(uciMove(replyMove.uci));
        setSessionPlies((current) => [
          ...current,
          {
            ply: (current[current.length - 1]?.ply ?? 0) + 1,
            san: replyMove.san,
            uci: replyMove.uci,
            onRails: false,
          },
        ]);
        readPosition(null);
        setStatus((current) => (current === 'over' ? current : 'playing'));
      } catch {
        if (cancelled) return;
        // The player's move is committed on the board; handing the turn back
        // means taking it off again, so the retry starts from the same position.
        chess.undo();
        setSessionPlies((current) => current.slice(0, -1));
        setEndpointError('The opponent could not answer. Please try again.');
        setStatus((current) => (current === 'over' ? current : 'playing'));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [status]);

  const stop = () => {
    const gloss = resultGloss(game.result, game.playerColor);
    finish(gloss === null ? 'You stopped the session.' : `The real game: ${gloss}.`);
  };

  const currentMove = sessionPlies[sessionPlies.length - 1];
  const boardDisabled = status !== 'playing' || !playerTurn;

  return (
    <div className="space-y-4">
      <Heading level={1} className="reveal-in">
        Finish your own game
      </Heading>
      <Text as="p" display="block" type="supporting" className="reveal-in text-sm">
        From move {Math.ceil(startPly / 2)}: you played{' '}
        <span className="font-mono">{mistake?.moveSan ?? 'this position'}</span>
        {mistake?.bestMoveSan !== undefined ? (
          <>
            ; best was <span className="font-mono">{mistake.bestMoveSan}</span>
          </>
        ) : null}
        . Play on from here. Nothing here touches your streak or your records.
      </Text>

      <section aria-label="Position" className="mt-8 space-y-4">
        <div className="flex w-[480px] max-w-full items-stretch gap-4">
          <Board
            fen={fen}
            from={currentMove?.uci.slice(0, 2)}
            to={currentMove?.uci.slice(2, 4)}
            flipped={!playerIsWhite}
            selectedSquare={boardDisabled ? undefined : (selected ?? undefined)}
            targetSquares={boardDisabled ? undefined : targetSquares}
            draggableSquares={boardDisabled ? undefined : movableSquares}
            onSquareClick={boardDisabled ? undefined : onSquareClick}
            label={`Finish session. ${describePosition(fen)}`}
          />
        </div>

        <div className="flex items-center gap-2">
          {status === 'playing' && !playerTurn ? (
            <Text type="supporting" className="text-sm">
              The game as it was played continues…
            </Text>
          ) : null}
          {status === 'thinking' ? (
            <span className="flex items-center gap-2" role="status" aria-label="Opponent thinking">
              <Spinner size="sm" />
              <Text type="supporting" className="text-sm">
                The opponent is thinking…
              </Text>
            </span>
          ) : null}
          {status === 'playing' && playerTurn ? (
            <Button label="Stop the session" variant="secondary" onClick={stop} className="press" />
          ) : null}
          {status === 'over' ? (
            <Button
              label="Back to the game review"
              variant="primary"
              onClick={() => {
                void navigate({ to: '/games/$gameId', params: { gameId: game.id } });
              }}
              className="press"
            />
          ) : null}
          {endpointError !== null ? (
            <Text as="p" display="block" role="alert" className="text-sm">
              {endpointError}
            </Text>
          ) : null}
        </div>

        {outcome !== null ? (
          <Card className="p-4">
            <Text as="p" display="block" role="status">
              {outcome}
            </Text>
          </Card>
        ) : null}

        <Card className="space-y-2 p-4">
          <Heading level={3} className="text-sm font-semibold">
            The session so far
          </Heading>
          <ol className="flex flex-wrap gap-2">
            {sessionPlies.map((entry) => (
              <li
                key={`${entry.ply}-${entry.san}`}
                className={`rounded-control px-2 py-0.5 font-mono text-sm ${
                  entry.onRails ? '' : 'border border-border-strong bg-raised'
                }`}
              >
                {entry.san}
              </li>
            ))}
          </ol>
        </Card>
      </section>
    </div>
  );
}

export function FinishGameRoute() {
  const { gameId } = useParams({ from: '/account/games/$gameId/finish' });
  const { ply } = useSearch({ from: '/account/games/$gameId/finish' });
  const query = useQuery(gameQueryOptions(gameId));

  if (query.isPending) {
    return (
      <div role="status" aria-label="Loading" aria-busy="true" className="space-y-4">
        <div className="h-8 w-48 rounded-control bg-sunken" />
        <div className="h-64 rounded-surface bg-sunken" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div>
        <Heading level={1}>This page could not be reached.</Heading>
        <Text as="p" display="block" type="supporting" className="mt-4">
          Check your connection and try again.
        </Text>
        <Button
          label="Try again"
          variant="primary"
          clickAction={() => {
            void query.refetch();
          }}
          className="mt-6 press"
        />
      </div>
    );
  }

  return <FinishGameScreen game={query.data} mistakePly={ply ?? 0} />;
}
