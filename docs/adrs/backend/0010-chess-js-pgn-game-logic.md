# 0010. Chess logic and storage: chess.js, PGN for games, FEN for positions

* Status: accepted
* Date: 2026-07-31

## Context

The backend has to handle chess as data: validate moves, load games,
render positions, and store everything. Three decisions sit together here
because they interlock. A move validation library, a PGN parser, and a
storage format for games and positions.

For storage, the alternatives were a normalized move table, a custom JSON
move list, or the standard interchange formats. Lichess, the largest open
chess deployment, stores and distributes games as PGN text and evaluation
data as FEN-keyed records; that pattern is the reference.

## Decision

Use chess.js (version 1.4 at the time of writing) for move generation and
validation, FEN handling, and PGN round-tripping. It is the standard
JavaScript chess library, TypeScript-native, and pure: given a position
and a move, the result is deterministic, which is exactly what the testing
policy asks of chess logic. For PGN files with nested variations and
comments, where chess.js's parser is lossy, use `@mliebelt/pgn-parser`.

Storage follows the interchange formats. A game is stored as its full PGN
text, the canonical record, with denormalized columns (players, date,
result, starting FEN) for querying. A position that needs lookup or
indexing, such as a puzzle or an analysis snapshot, is stored as FEN.
Move lists are derived on demand through chess.js rather than stored as a
second source of truth.

## Consequences

Two new runtime dependencies. Chess rules stay out of our codebase, which
removes an entire category of bug: no hand-rolled move legality, no
homegrown FEN parser. The PGN-as-source-of-truth choice means the stored
game is always exportable and importable by every other chess tool, at
the cost of parsing PGN when a move list is needed. Chess logic being
pure keeps the fast unit-test tier available for everything except actual
persistence.
