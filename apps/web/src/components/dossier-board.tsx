import type { ReactNode } from 'react';
import { PIECE_NAMES, PIECE_PATHS } from './board.tsx';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

export interface DossierBoardProps {
  fen: string;
  from?: string;
  to?: string;
  bestFrom?: string;
  bestTo?: string;
  flipped?: boolean;
  label: string;
  title?: string;
  movePlayed?: string;
  bestMove?: string;
  motif?: string;
}

interface PlacedPiece {
  file: number;
  rank: number;
  type: string;
  white: boolean;
}

function parsePieces(fen: string): PlacedPiece[] {
  const board = fen.split(' ')[0] ?? '';
  const pieces: PlacedPiece[] = [];
  const ranks = board.split('/');
  for (let rankIndex = 0; rankIndex < ranks.length; rankIndex++) {
    const row = ranks[rankIndex] ?? '';
    let file = 0;
    for (const char of row) {
      if (char >= '1' && char <= '8') {
        file += Number.parseInt(char, 10);
        continue;
      }
      pieces.push({
        file,
        rank: 7 - rankIndex,
        type: char.toUpperCase(),
        white: char === char.toUpperCase(),
      });
      file += 1;
    }
  }
  return pieces;
}

function squareCenter(square: string, flipped: boolean): { x: number; y: number } {
  const fileChar = square[0]?.toLowerCase() ?? 'a';
  const rankChar = square[1] ?? '1';
  const file = FILES.indexOf(fileChar);
  const rank = Number.parseInt(rankChar, 10) - 1;
  const col = flipped ? 7 - file : file;
  const row = flipped ? rank : 7 - rank;
  return { x: col + 1 + 0.5, y: row + 1 + 0.5 };
}

/**
 * ST-186. Compact static high-contrast chess board diagram designed
 * specifically for monochrome paper printing and PDF export.
 */
export function DossierBoard({
  fen,
  from,
  to,
  bestFrom,
  bestTo,
  flipped = false,
  label,
  title,
  movePlayed,
  bestMove,
  motif,
}: DossierBoardProps) {
  const pieces = parsePieces(fen);
  const elements: ReactNode[] = [];

  for (let col = 0; col < 8; col++) {
    const file = flipped ? 7 - col : col;
    for (let row = 0; row < 8; row++) {
      const rank = flipped ? row : 7 - row;
      const isLight = (file + rank) % 2 !== 0;
      const square = `${FILES[file]}${rank + 1}`;
      const isFrom = square === from;
      const isTo = square === to;

      let fill = isLight ? '#ffffff' : '#e5e5e5';
      if (isFrom || isTo) {
        fill = '#fde047';
      }

      elements.push(
        <rect
          key={`sq-${col}-${row}`}
          x={col + 1}
          y={row + 1}
          width={1}
          height={1}
          fill={fill}
          stroke="#737373"
          strokeWidth={0.02}
          className={isLight ? 'dossier-square-light' : 'dossier-square-dark'}
        />,
      );
    }
  }

  for (let col = 0; col < 8; col++) {
    const file = flipped ? 7 - col : col;
    const fileLabel = FILES[file] ?? '';
    elements.push(
      <text
        key={`file-bot-${col}`}
        x={col + 1 + 0.5}
        y={9.5}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={0.35}
        fill="#000000"
        className="dossier-coord font-mono"
      >
        {fileLabel}
      </text>,
    );
  }

  for (let row = 0; row < 8; row++) {
    const rank = flipped ? row : 7 - row;
    const rankLabel = String(rank + 1);
    elements.push(
      <text
        key={`rank-left-${row}`}
        x={0.5}
        y={row + 1 + 0.5}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={0.35}
        fill="#000000"
        className="dossier-coord font-mono"
      >
        {rankLabel}
      </text>,
    );
  }

  for (const p of pieces) {
    const col = flipped ? 7 - p.file : p.file;
    const row = flipped ? p.rank : 7 - p.rank;
    const path = PIECE_PATHS[p.type];
    if (path === undefined) continue;

    const fill = p.white ? '#ffffff' : '#171717';
    const stroke = p.white ? '#171717' : '#ffffff';

    elements.push(
      <g
        key={`p-${p.file}-${p.rank}`}
        transform={`translate(${col + 1 - 0.03}, ${row + 1 - 0.03}) scale(0.0235)`}
        role="img"
        aria-label={`${p.white ? 'white' : 'black'} ${PIECE_NAMES[p.type]}`}
      >
        <path d={path} fill={fill} stroke={stroke} strokeWidth={1.8} strokeLinejoin="round" />
      </g>,
    );
  }

  if (bestFrom !== undefined && bestTo !== undefined) {
    const start = squareCenter(bestFrom, flipped);
    const end = squareCenter(bestTo, flipped);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length > 0) {
      const ux = dx / length;
      const uy = dy / length;
      const tipX = end.x - ux * 0.22;
      const tipY = end.y - uy * 0.22;
      const head = 0.22;
      const baseX = tipX - ux * head * 1.3;
      const baseY = tipY - uy * head * 1.3;
      const nx = -uy;
      const ny = ux;

      elements.push(
        <g key="best-arrow">
          <line
            x1={start.x}
            y1={start.y}
            x2={tipX}
            y2={tipY}
            stroke="#15803d"
            strokeWidth={0.14}
            strokeLinecap="round"
          />
          <polygon
            points={`${tipX},${tipY} ${baseX + nx * head},${baseY + ny * head} ${baseX - nx * head},${baseY - ny * head}`}
            fill="#15803d"
          />
        </g>,
      );
    }
  }

  return (
    <figure className="dossier-board flex flex-col items-center">
      <div className="relative aspect-square w-full max-w-[240px] rounded border border-neutral-400 bg-white p-1">
        <svg viewBox="0 0 10 10" className="h-full w-full" role="region" aria-label={label}>
          {elements}
        </svg>
      </div>
      <figcaption className="mt-2 text-center text-xs text-neutral-800">
        {title && <div className="font-semibold text-black">{title}</div>}
        {movePlayed && bestMove && (
          <div className="mt-0.5">
            Played: <span className="font-mono text-neutral-600 line-through">{movePlayed}</span> ·
            Best: <span className="font-mono font-semibold text-green-800">{bestMove}</span>
          </div>
        )}
        {motif && <div className="mt-0.5 italic text-neutral-600">{motif}</div>}
      </figcaption>
    </figure>
  );
}
