# 0029. Use ChessOps for attack and threat detection

* Status: accepted
* Date: 2026-08-12

## Context

The Socratic Coach leans on two analytical primitives in
`apps/api/src/chess/diagnostic-utils.ts`: `computeHygiene` (attacker and
defender counts on a blunder's target square) and `findCCT` (enumerate all
Checks, Captures, and Threats from a position). Both currently hand-roll the
chess physics with a homegrown ray-caster over a `chess.js` board array.

That hand-rolled geometry is the source of DEBT-005: threat detection counts
static attackers and defenders rather than searching, so a threat that needs
two moves to see (a discovered attack, a pin, a quiet move that lifts a
blocker) is invisible to it, and a quiet king move that creates nothing gets
flagged as a Material threat when a free capture already exists. The ray
logic is also subtle to get right and has no external reference to check
against.

ChessOps by Niklas Fiekas (the author of Lichess's tooling) is the reference
TypeScript chess library used by Lichess itself. It provides bitboard attack
calculations (`attacks`, `ray`, `between`) using Hyperbola Quintessence, legal
move generation, and FEN/PGN/SAN handling. Its attack functions are the same
primitive Lichess uses for exactly this kind of tactical detection.

## Decision

Adopt ChessOps for threat detection in `diagnostic-utils.ts`. Replace the
null-move static counter in `findCCT` (and the `countAttackersOfSquare`
ray-caster it relies on) with ChessOps's `attacks` function, which computes
the squares a piece attacks given the occupied squares.

Rewrite `findCCT`'s threat detection as a one-ply delta search instead of the
null-move static counter:

* For each quiet legal move, play it on a cloned position and recompute which
  enemy non-king pieces are hanging (attackers outnumber defenders).
* A move is a Material threat if it creates a hanging enemy piece that was not
  hanging before the move.
* A move is a Checkmate threat if, after the move, the side to move has a
  mate-in-one.
* A quiet move that changes nothing about the hanging set is not a threat,
  which removes the king-move false positive.

The hygiene feature (`computeHygiene`, `hasXrayAttacker`, and the
`rayCastDCXC` x-ray model they share) is also migrated to ChessOps. ChessOps
has no direct "attackers of a square" or DC/XC split, so the migration is
partial: the Direct-Contact counts now use ChessOps's `attacks` (Hyperbola
Quintessence) and the usefulness check in `findCCT` uses `kingAttackers`, while
the X-ray counts keep the per-piece x-ray rules (rook through friendly R/Q,
bishop through friendly Q/B or an adjacent pawn, queen through friendly
Q/R/B or an adjacent pawn) reimplemented over ChessOps's `ray` and `between`
geometry. The x-ray rules themselves are unchanged; only the geometry backing
them is now ChessOps. This also removes the last hand-rolled ray-caster and
the `pieceAttacks`/`squareToRC` helpers, which were a second source of truth
for the chess physics.

ChessOps is added as a runtime dependency of the API workspace. It coexists
with `chess.js`, which remains the library for PGN round-tripping and move
validation (ADR-0010); ChessOps is used only where attack geometry is needed.

## Consequences

Threat detection becomes search-based rather than static, closing DEBT-005:
discovered attacks and quiet moves that lift a blocker are now seen, and the
false positive where a quiet king move is flagged because a free capture
already exists is gone. The hand-rolled ray-casters are deleted, removing a
subtle geometry bug and a second source of truth for the chess physics.

The cost is a second chess library in the runtime, and with it two APIs for
positions. The boundary is kept narrow: ChessOps is imported only by
`diagnostic-utils.ts`, and its `Chess` type never leaks past that module's
public surface, which still speaks FEN strings and chess.js-style SAN. The
one-ply delta search is still a heuristic, not a full engine search; it sees
tactics one quiet move deep, which is the depth the coaching layer (ADR-0018)
needs, and deeper search remains the engine's job.

ChessOps validates positions strictly (it rejects illegal positions such as a
side to move already in check), where chess.js tolerated them. The
`hasXrayAttacker` test positions were corrected to be legal as a result; this
is a test-only change and does not alter the function's contract.
