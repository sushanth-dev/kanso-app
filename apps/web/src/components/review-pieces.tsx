import { useEffect, useRef, type ReactNode } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import type { MovePly } from '../api/diagnosis-api.ts';
import type { Mistake } from '../api/diagnosis-api.ts';
import { useRevealSequence } from '../use-reveal-sequence.ts';
import { evalLabel } from './eval-bar.tsx';

/**
 * ST-118. The review composition the owner's route and the shared read-only
 * page render from: the notation panel, the move and mistake cards, and the
 * result gloss. The board itself is already a shared component; these are the
 * pieces around it, so the shared page composes the same rendering rather
 * than a second implementation. The mistake type here omits the coach
 * explanation: the shared payload never carries it, and the owner's route
 * reads the texts through their own endpoints.
 */
export type ReviewMistake = Omit<Mistake, 'explanation'>;

export interface MoveCardGame {
  whiteName: string | null;
  blackName: string | null;
  playerColor: 'white' | 'black' | null;
}

export const JUDGEMENT_LABEL: Record<Mistake['judgement'], string> = {
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
};

export const JUDGEMENT_GLYPH: Record<Mistake['judgement'], string> = {
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
};

export const MOTIF_LABEL: Record<string, string> = {
  hanging_piece: 'Hung a piece',
  missed_check: 'Missed a check',
  missed_capture: 'Missed a capture',
  missed_threat: 'Missed a threat',
};

/** The side to move at a ply's pre-move position, read off the FEN. */
export function movingColorOf(ply: MovePly): 'white' | 'black' {
  return ply.fenBefore.split(' ')[1] === 'b' ? 'black' : 'white';
}

/** The name of the side that made a move, falling back to a generic label. */
export function moverName(color: 'white' | 'black', game: MoveCardGame): string {
  return color === 'white' ? (game.whiteName ?? 'White') : (game.blackName ?? 'Black');
}

/** "won", "lost" or "drew" from the player's side, or null when neither is known. */
export function resultGloss(
  result: string,
  playerColor: 'white' | 'black' | null,
): 'won' | 'lost' | 'drew' | null {
  if (result === '1/2-1/2') return 'drew';
  if (playerColor === null) return null;
  if (result === '1-0') return playerColor === 'white' ? 'won' : 'lost';
  if (result === '0-1') return playerColor === 'black' ? 'won' : 'lost';
  return null;
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
  mistake: ReviewMistake | undefined;
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

export function Notation({
  plies,
  mistakes,
  currentPly,
  onSelect,
}: {
  plies: MovePly[];
  mistakes: ReviewMistake[];
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

/**
 * The card under the board: what was played and what it cost. The mistake
 * variant carries the judgement, the centipawn loss and the motif; the plain
 * variant is the move and the running advantage. `drillHref` is the owner's
 * route alone - the shared page never offers account actions.
 */
export function MoveCard({
  game,
  ply,
  mistake,
  drillHref,
}: {
  game: MoveCardGame;
  ply: MovePly;
  mistake?: ReviewMistake;
  drillHref?: string;
}) {
  if (mistake === undefined) {
    return (
      <Card className="space-y-2">
        <Text as="p" display="block">
          Move {Math.ceil(ply.ply / 2)}:{' '}
          {movingColorOf(ply) === game.playerColor ? (
            <>
              you played <span className="font-mono">{ply.san}</span>.
            </>
          ) : (
            <>
              {moverName(movingColorOf(ply), game)} played{' '}
              <span className="font-mono">{ply.san}</span>.
            </>
          )}
        </Text>
        <Text as="p" display="block" type="supporting" className="font-mono text-sm">
          Advantage: {evalLabel(ply.evaluation)}
        </Text>
      </Card>
    );
  }
  return (
    <Card className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge label={JUDGEMENT_LABEL[mistake.judgement]} variant="neutral" />
        <Text type="supporting" className="font-mono text-sm">
          -{(mistake.cpLoss / 100).toFixed(1)} pawns
        </Text>
      </div>
      <Text as="p" display="block">
        Move {mistake.moveNumber}:{' '}
        {mistake.movingColor === game.playerColor ? (
          <>
            you played <span className="font-mono">{mistake.moveSan}</span>; best was{' '}
            <span className="font-mono">{mistake.bestMoveSan}</span>.
          </>
        ) : (
          <>
            {moverName(mistake.movingColor, game)} played{' '}
            <span className="font-mono">{mistake.moveSan}</span>; best was{' '}
            <span className="font-mono">{mistake.bestMoveSan}</span>.
          </>
        )}
      </Text>
      <Text as="p" display="block" type="supporting" className="font-mono text-sm">
        Advantage: {evalLabel(mistake.evalBefore)} → {evalLabel(mistake.evalAfter)}
      </Text>
      {mistake.motif !== null ? (
        <Text as="p" display="block" type="supporting" className="text-sm">
          {MOTIF_LABEL[mistake.motif] ?? mistake.motif}
        </Text>
      ) : null}
      {drillHref !== undefined ? <Link href={drillHref}>Drill this pattern</Link> : null}
    </Card>
  );
}

/**
 * ST-138. The post-game result is the review's one authored motion moment,
 * the GSAP replacement for the ParticleReveal ST-132 removed. The mono result
 * figure fades and rises, then the gloss line follows on the same ease. The
 * accessible values are sr-only spans and the animated figures are aria-hidden
 * on top of them, the dual-span pattern ST-133 landed on the hero. Under
 * reduced motion nothing animates and the DOM's natural state, which is also
 * the state before any JavaScript runs, is the final state.
 */
export function ResultReveal({ result, gloss }: { result: string; gloss?: ReactNode }) {
  const figureRef = useRef<HTMLSpanElement | null>(null);
  const glossRef = useRef<HTMLParagraphElement | null>(null);
  useRevealSequence(figureRef, glossRef, [result, gloss]);
  return (
    <>
      <Text className="font-mono text-lg text-primary">
        <span className="sr-only">{result}</span>
        <span ref={figureRef} aria-hidden="true">
          {result}
        </span>
      </Text>
      {gloss !== undefined && gloss !== null ? (
        <Text as="p" display="block" ref={glossRef}>
          {gloss}
        </Text>
      ) : null}
    </>
  );
}
