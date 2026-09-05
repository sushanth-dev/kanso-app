import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { ApiRequestError } from '../api/account-api.ts';
import { sharedGameApi, type SharedGame } from '../api/game-share-api.ts';
import { Mark } from '../components/mark.tsx';
import { Board, describePosition } from '../components/board.tsx';
import { MoveCard, Notation, movingColorOf, resultGloss } from '../components/review-pieces.tsx';

/**
 * ST-118. The shared game's read-only composition: the same board, notation
 * panel and mistake card the review screen renders from review-pieces, minus
 * every account affordance. No back link, no delete, no colour setting, no
 * drill link, and no coach cards - the explanation and the Socratic question
 * stay behind the session, so opening a link never spends a budget unit.
 * Stepping through the game is viewing, not mutation, so the transport stays.
 */
export function SharedGameScreen({ shared }: { shared: SharedGame }) {
  const [plyIndex, setPlyIndex] = useState(() => {
    const firstMistake = shared.mistakes[0];
    if (firstMistake === undefined) return 0;
    const index = shared.plies.findIndex((ply) => ply.ply === firstMistake.ply);
    return index === -1 ? 0 : index;
  });
  // The player's own side sits at the bottom, the review screen's default.
  const [flipped, setFlipped] = useState(() => shared.playerColor === 'black');

  useEffect(() => {
    const white = shared.whiteName ?? 'Unknown';
    const black = shared.blackName ?? 'Unknown';
    document.title = `${white} vs ${black} · Kanso Chess`;
    return () => {
      document.title = 'Kanso Chess';
    };
  }, [shared.whiteName, shared.blackName]);

  const gloss = resultGloss(shared.result, shared.playerColor);
  const currentPly = shared.plies[plyIndex];
  const currentMistake = shared.mistakes.find((mistake) => mistake.ply === currentPly?.ply);
  const stepBy = (delta: number) => {
    setPlyIndex((index) => Math.min(Math.max(index + delta, 0), shared.plies.length - 1));
  };
  const selectPly = (ply: number) => {
    const index = shared.plies.findIndex((movePly) => movePly.ply === ply);
    if (index !== -1) setPlyIndex(index);
  };

  if (currentPly === undefined) {
    return (
      <>
        <Text as="p" display="block" type="supporting" className="text-sm">
          A shared game review
        </Text>
        <Heading level={1}>
          {shared.whiteName ?? 'Unknown'} vs {shared.blackName ?? 'Unknown'}
        </Heading>
        <Card className="mt-6 p-6">
          <Text as="p" display="block" type="supporting">
            No recorded moves in this game.
          </Text>
        </Card>
      </>
    );
  }

  return (
    <>
      <Text as="p" display="block" type="supporting" className="text-sm">
        A shared game review
      </Text>
      <Heading level={1}>
        {shared.whiteName ?? 'Unknown'} vs {shared.blackName ?? 'Unknown'}
      </Heading>
      <Text className="font-mono text-lg text-primary">{shared.result}</Text>
      {gloss !== null ? <Text as="p" display="block">{`The player ${gloss}.`}</Text> : null}

      <section aria-label="Position" className="mt-8 space-y-4">
        <div className="flex flex-wrap items-start gap-6">
          <div className="w-[480px] max-w-full">
            <Board
              fen={currentPly.fenBefore}
              from={currentPly.uci.slice(0, 2)}
              to={currentPly.uci.slice(2, 4)}
              bestFrom={currentPly.bestMoveUci?.slice(0, 2)}
              bestTo={currentPly.bestMoveUci?.slice(2, 4)}
              flipped={flipped}
              label={`Position before move ${Math.ceil(currentPly.ply / 2)}, ${movingColorOf(currentPly)} to move. ${describePosition(currentPly.fenBefore)}`}
            />
          </div>

          <Notation
            plies={shared.plies}
            mistakes={shared.mistakes}
            currentPly={currentPly}
            onSelect={selectPly}
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
            isDisabled={plyIndex === shared.plies.length - 1}
            onClick={() => stepBy(1)}
          />
          <Button
            label="Flip board"
            variant="secondary"
            onClick={() => setFlipped((value) => !value)}
          />
          <Text type="supporting" className="font-mono text-sm">
            {`Move ${Math.ceil((plyIndex + 1) / 2)} of ${Math.ceil(shared.plies.length / 2)}`}
          </Text>
        </div>

        <MoveCard game={shared} ply={currentPly} mistake={currentMistake} />
      </section>
    </>
  );
}

export function SharedGameRoute() {
  const { token } = useParams({ from: '/shared/games/$token' });
  const query = useQuery({
    queryKey: ['shared-game', token],
    queryFn: () => sharedGameApi.getShared(token),
    retry: false,
  });

  if (query.isPending) {
    return (
      <main
        role="status"
        aria-label="Loading"
        aria-busy="true"
        className="mx-auto w-full max-w-2xl px-4 py-16 font-ui"
      >
        <div className="h-8 w-48 rounded-control bg-sunken" />
        <div className="mt-3 h-4 w-72 rounded-control bg-sunken" />
      </main>
    );
  }

  // Revoked, expired, and unknown links are the API's one indistinguishable 404;
  // the page says the same thing for all of them rather than naming which case.
  if (query.isError && query.error instanceof ApiRequestError && query.error.status === 404) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-16 font-ui">
        <Heading level={1}>This link is no longer available.</Heading>
      </main>
    );
  }

  // A fetch that never reached the server (a network failure or a 5xx) is a
  // different state from a dead link: the reader may still be able to reach
  // the page, so offer a retry rather than a dead end.
  if (query.isError) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-16 font-ui">
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
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16 font-ui">
      <div aria-hidden="true" className="mb-6">
        <Mark size={28} />
      </div>
      <SharedGameScreen shared={query.data} />
    </main>
  );
}
