# ST-186 Printable Tournament Dossier Implementation Plan

> Implement a clean, print-optimized 1-2 page tournament dossier for coaches and parents with high-contrast board diagrams, round decay analysis, and a coach notes debrief box.

## User review required

- Native browser `window.print()` is used with `@media print` and `@page` rules for US Letter/A4 pagination without external PDF dependencies.

## Proposed Changes

### 1. Print Styles
- `apps/web/src/styles/print.css`:
  - `@page { size: letter portrait; margin: 12mm 15mm; }`
  - Targets `#tournament-dossier`, ensuring black ink on white background, hiding interactive controls (`header`, `nav`, `button`, `.print:hidden`).
  - Strict pagination controls: `break-inside: avoid` on tables, cards, board diagrams, and coach notes; `break-before: page` for 2-page pagination boundary.
  - High-contrast SVG print rendering (`print-color-adjust: exact`).
  - Import in `apps/web/src/styles.css`.

### 2. Static High-Contrast Board Diagram Component
- `apps/web/src/components/dossier-board.tsx`:
  - Compact static SVG board (using cburnett piece vectors from `board.tsx`) optimized for monochrome high-contrast printing.
  - Visible coordinate ranks (1-8) and files (a-h).
  - Clear from/to highlight outlines and best-move arrows for mistake diagrams.

### 3. Tournament Dossier Route & Component
- `apps/web/src/routes/tournament-dossier-route.tsx`:
  - Header: Student name, tournament title, site, dates, score (`3.5 / 5.0`), TPR, total games.
  - Section 1: Tournament performance table (round, board, color, opponent, result, centipawn loss).
  - Section 2: Ranked weakness & leak motifs summary from tournament report.
  - Section 3: Key tactical mistake diagrams (up to 3 positions with move played vs engine best move).
  - Section 4: Coach debrief notes (ruled lined blank box for hand-written notes during parent/student conferences) and Kanso Chess verification stamp.
  - Action buttons: "Print dossier" (`window.print()`) and "Back to tournament" (hidden in print).

### 4. Router & Tournament Detail Header Trigger
- `apps/web/src/router.tsx`:
  - Register `/tournaments/$tournamentId/dossier` route.
- `apps/web/src/routes/tournament-detail-route.tsx`:
  - Add "Print dossier" secondary button to header next to "Download PGN".

### 5. Verification
- `apps/web/src/routes/tournament-dossier-route.test.tsx`:
  - Test dossier rendering: student header, games table, weakness breakdown, coach notes box, and print trigger.
- `apps/web/src/routes/tournament-detail-route.test.tsx`:
  - Verify "Print dossier" action button in header links to `/tournaments/$tournamentId/dossier`.
- Run full test suite: `pnpm test`.

## Tasks

- [ ] Task 1: Print styles in `apps/web/src/styles/print.css` and import in `styles.css`
- [ ] Task 2: Static high-contrast board diagram component in `apps/web/src/components/dossier-board.tsx`
- [ ] Task 3: Tournament dossier route and screen in `apps/web/src/routes/tournament-dossier-route.tsx` and router registration
- [ ] Task 4: Header trigger button in `tournament-detail-route.tsx` and comprehensive unit tests
- [ ] Task 5: Full suite verification, story status update, and commit
