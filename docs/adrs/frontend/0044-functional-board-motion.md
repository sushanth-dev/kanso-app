# 0044. Animate functional board state on the shared motion tokens

* Status: accepted
* Date: 2026-09-08
* Builds on: [ADR-0043](0043-retire-canvas-ui-threeui-awwwards-redesign.md),
  [ADR-0031](0031-impeccable-frontend-refinement.md)

## Context

The design prose carried a "the board never animates" rule, descended from
ADR-0017's separation of decorative effects from the functional interface.
The rule was right about what it governed - WebGL reveals never touch the
board - but it grew into a ban on all board motion, including the one kind
of motion that carries information: which piece moved from where to where.
Every position change teleported the pieces, in review stepping and in
practice alike.

On 8 September 2026 Sushanth directed that the application be elevated with
the Emil Kowalski design-engineering skills (installed in both agent setups
that day, replacing `build-awwwards-quality-sites`). An audit of the motion
surface against that bar found the teleporting board the single
highest-leverage finding, alongside an evaluation bar animating layout
height, an infinite focus pulse, a decorative hover sweep on every pressable,
stagger entrances replaying on tab flips, and a reduced-motion override that
zeroed comprehension fades along with movement. Per ADR-0031 this kind of
finding is Sushanth's own decision and its own record; this ADR is that
record.

## Decision

Functional board state animates, on the existing `--kanso-motion-*` tokens
and nothing else. No dependency is added; the pieces slide through the Web
Animations API, everything else stays CSS.

* A position change diffs the previous placement against the current one and
  slides the pieces that changed squares - 200ms (base) on the standard ease.
  The diff covers castling (two pieces slide), en passant, and stepping
  backwards through a game. Captured pieces are simply gone, as on the board.
* A drag that lands commits the move with the drag itself as the travel: the
  slide is suppressed for exactly that from-to pair. A drop that commits
  nothing rides a 120ms (fast) snap-back ghost from the drop point to the
  square the piece came from.
* Drag gains the quiet feedback the pointer already implies: grab and
  grabbing cursors, a hover ring on the square under the pointer, a slight
  lift on the dragged piece.
* The evaluation bar's black share animates as a transform (scaleY from the
  bottom edge, base 200ms) instead of layout height.
* Tab-flipped panels - the games list, the curriculum lists, the puzzle
  queue tabs - swap instantly. The stagger is a page-load entrance, not a
  replay for rapid state changes.
* The `.press` hover sweep is removed; press feedback stays scale(0.98) at
  the fast duration. The text-input focus glow settles once (180ms) instead
  of pulsing for as long as the field holds focus.
* Reduced motion keeps color, border, and shadow transitions - they aid
  comprehension and carry no movement - while every transform-driven change
  stays instant. Where the Web Animations API is unavailable, positions are
  already final and nothing breaks.

The landing page's board group remains a still life: marketing motion stays
as ADR-0043 left it, and the pieces there never animate.

## Consequences

The board reads as a board: moves explain themselves, drags feel held, and
stepping through a game no longer redraws the world once per ply. The cost
is one animation per piece change (at most two for castling) on transform
only, with the previous position kept for the diff - no layout reads, no
library, no new bundle weight.

DESIGN.md's Motion section and the surface sections that repeat the
board-never-animates rule are rewritten from what ships, per ADR-0031. The
reduced-motion contract changes shape: movement collapses to zero as before,
but comprehension transitions now keep their fast duration; the blanket
zero-duration override is scoped accordingly.
