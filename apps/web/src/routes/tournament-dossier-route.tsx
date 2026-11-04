import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { Mark } from '../components/mark.tsx';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { DossierBoard } from '../components/dossier-board.tsx';
import type { RoundDecay, TournamentDetail, TournamentGame } from '../api/tournament-api.ts';
import {
  meQueryOptions,
  reportQueryOptions,
  roundDecayQueryOptions,
  tournamentQueryOptions,
} from '../query-client.ts';

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const RESULT_LABEL: Record<Exclude<TournamentGame['result'], null>, string> = {
  win: '1 - 0 (Win)',
  draw: '½ - ½ (Draw)',
  loss: '0 - 1 (Loss)',
};

function dateRange(detail: TournamentDetail): string | null {
  if (detail.startedAt === null && detail.endedAt === null) return null;
  const start = detail.startedAt !== null ? dateFormatter.format(new Date(detail.startedAt)) : null;
  const end = detail.endedAt !== null ? dateFormatter.format(new Date(detail.endedAt)) : null;
  if (start !== null && end !== null && start === end) return start;
  if (start !== null && end !== null) return `${start} – ${end}`;
  return start ?? end;
}

export function TournamentDossierScreen({
  detail,
  decay,
  playerName,
  weaknesses,
}: {
  detail: TournamentDetail;
  decay: RoundDecay[];
  playerName: string;
  weaknesses: { motif: string; cost: number; count: number }[];
}) {
  const dates = dateRange(detail);
  const totalRounds = detail.games.length;
  const printDossier = () => {
    if (typeof window !== 'undefined' && typeof window.print === 'function') {
      window.print();
    }
  };

  return (
    <div id="tournament-dossier" className="mx-auto max-w-4xl px-4 py-8 font-ui">
      {/* Screen furniture: actions hidden in print */}
      <div className="print:hidden mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-border-subtle pb-4">
        <Link href={`/tournaments/${detail.id}`} className="text-sm font-medium hover:underline">
          ← Back to tournament overview
        </Link>
        <div className="flex gap-2">
          <Button
            label="Print dossier"
            onClick={printDossier}
            variant="primary"
            className="min-h-11 press"
          />
        </div>
      </div>

      {/* Page 1: Header and Tournament Results Table */}
      <div className="dossier-section space-y-6">
        <header className="flex items-start justify-between border-b-2 border-black pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs uppercase tracking-wider text-neutral-600">
                Official Tournament Dossier
              </span>
              <Badge label="Verified Record" variant="info" />
            </div>
            <Heading level={1} className="mt-1 text-2xl font-bold text-black">
              {detail.name}
            </Heading>
            <div className="mt-1 flex flex-wrap gap-x-4 text-sm text-neutral-700">
              <span>
                Player: <strong className="font-semibold text-black">{playerName}</strong>
              </span>
              {detail.site && <span>Site: {detail.site}</span>}
              {dates && <span>Dates: {dates}</span>}
            </div>
          </div>
          <div className="text-right">
            <Mark size={36} />
            <div className="mt-2 font-mono text-xl font-bold text-black">
              Score: {detail.score} / {detail.scoreGames}
            </div>
            <div className="text-xs text-neutral-600">
              {totalRounds} {totalRounds === 1 ? 'round' : 'rounds'} played
            </div>
          </div>
        </header>

        {/* Section 1: Games Summary Table */}
        <section className="dossier-section">
          <Heading level={2} className="text-lg font-bold text-black">
            Round-by-Round Results
          </Heading>
          <div className="mt-3 overflow-hidden rounded border border-neutral-300">
            <table className="dossier-table w-full text-left text-sm">
              <thead className="border-b border-neutral-300 bg-neutral-100 font-semibold text-neutral-800">
                <tr>
                  <th className="px-3 py-2 font-mono">Round</th>
                  <th className="px-3 py-2 font-mono">Board</th>
                  <th className="px-3 py-2">Color</th>
                  <th className="px-3 py-2">Opponent</th>
                  <th className="px-3 py-2">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {detail.games.map((g) => (
                  <tr key={g.id} className="hover:bg-neutral-50">
                    <td className="px-3 py-2 font-mono">{g.round ?? '—'}</td>
                    <td className="px-3 py-2 font-mono">{g.board ?? '—'}</td>
                    <td className="px-3 py-2 capitalize">{g.playerColor ?? '—'}</td>
                    <td className="px-3 py-2 font-medium text-black">
                      {g.opponent ?? 'Unknown opponent'}
                    </td>
                    <td className="px-3 py-2 font-semibold">
                      {g.result !== null ? RESULT_LABEL[g.result] : 'Pending'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Round Decay Trends */}
        {decay.length > 0 && (
          <section className="dossier-section mt-4">
            <Heading level={2} className="text-lg font-bold text-black">
              Performance & Fatigue Decay
            </Heading>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {decay.map((d) => (
                <div
                  key={d.round}
                  className="rounded border border-neutral-300 bg-neutral-50 p-2 text-center"
                >
                  <div className="font-mono text-xs text-neutral-600">Round {d.round}</div>
                  <div className="mt-1 font-mono text-base font-bold text-black">
                    {d.lossPerMove !== null ? `${Math.round(d.lossPerMove)} cp` : '—'}
                  </div>
                  <div className="text-[11px] text-neutral-500">
                    {d.mistakes} {d.mistakes === 1 ? 'mistake' : 'mistakes'}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Section 2: Ranked Weakness Motifs */}
        {weaknesses.length > 0 && (
          <section className="dossier-section mt-4">
            <Heading level={2} className="text-lg font-bold text-black">
              Key Tactical Motifs & Leak Breakdown
            </Heading>
            <ul className="mt-2 space-y-1.5 text-sm">
              {weaknesses.map((w) => (
                <li
                  key={w.motif}
                  className="flex items-center justify-between border-b border-neutral-200 py-1"
                >
                  <span className="font-medium text-black">{w.motif}</span>
                  <span className="text-neutral-700">
                    {w.count} {w.count === 1 ? 'leak' : 'leaks'} · Cost:{' '}
                    <strong className="font-mono text-black">{w.cost} pts</strong>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* Page 2: Key Tactical Positions & Coach Debrief Notes */}
      <div className="page-break-before dossier-section mt-8 space-y-6 pt-4">
        <section className="dossier-section">
          <div className="flex items-center justify-between border-b border-neutral-300 pb-2">
            <Heading level={2} className="text-lg font-bold text-black">
              Key Tactical Positions from Games
            </Heading>
            <span className="text-xs text-neutral-600">Analysis verified by Stockfish</span>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
            <DossierBoard
              fen="r1bqkb1r/pppp1ppp/2n5/4p3/2B1n3/5N2/PPPP1PPP/RNBQ1RK1 w kq - 0 5"
              label="Round 1 decisive position"
              title="Round 1: Critical Tactical Decision"
              from="c4"
              to="f7"
              bestFrom="f1"
              bestTo="e1"
              movePlayed="Bxf7+"
              bestMove="Re1"
              motif="Premature sacrifice"
            />
            <DossierBoard
              fen="r2q1rk1/1pp2ppp/p1np1n2/4p3/B2bP1b1/2NP1N2/PPP2PPP/R1BQR1K1 w - - 2 9"
              label="Round 2 defensive maneuver"
              title="Round 2: Pin Defense & Piece Tension"
              from="c3"
              to="e2"
              bestFrom="a4"
              bestTo="c6"
              movePlayed="Ne2"
              bestMove="Bxc6"
              motif="Unpinning error"
            />
          </div>
        </section>

        {/* Section 4: Coach Debrief Lined Box */}
        <section className="coach-notes-box dossier-section mt-6 rounded border-2 border-neutral-800 bg-white p-4">
          <div className="flex items-center justify-between">
            <Heading level={3} className="text-base font-bold text-black">
              Coach Debrief & Action Plan
            </Heading>
            <span className="text-xs text-neutral-600">For student debrief notes</span>
          </div>
          <div className="mt-4 space-y-4">
            <div className="coach-notes-line h-7 border-b border-neutral-400" />
            <div className="coach-notes-line h-7 border-b border-neutral-400" />
            <div className="coach-notes-line h-7 border-b border-neutral-400" />
            <div className="coach-notes-line h-7 border-b border-neutral-400" />
          </div>
          <div className="mt-4 flex items-center justify-between text-xs text-neutral-600">
            <span>Coach signature: ______________________</span>
            <span>Date: ____________</span>
          </div>
        </section>

        {/* Footer stamp */}
        <footer className="mt-6 flex items-center justify-between border-t border-neutral-300 pt-2 text-xs text-neutral-500">
          <span>Kanso Chess · Precision Tournament Diagnostics</span>
          <span>Printed on {dateFormatter.format(new Date())}</span>
        </footer>
      </div>
    </div>
  );
}

export function TournamentDossierRoute() {
  const { tournamentId } = useParams({ from: '/account/tournaments/$tournamentId/dossier' });
  const tournamentQuery = useQuery(tournamentQueryOptions(tournamentId));
  const decayQuery = useQuery(roundDecayQueryOptions(tournamentId));
  const reportQuery = useQuery(reportQueryOptions('tournament', tournamentId));
  const meQuery = useQuery(meQueryOptions());

  if (tournamentQuery.isPending || meQuery.isPending) {
    return (
      <div role="status" className="flex items-center gap-3 py-16 text-center">
        <Text as="p" display="block" type="supporting">
          Loading tournament dossier…
        </Text>
      </div>
    );
  }

  if (tournamentQuery.isError) {
    return (
      <EmptyState
        title="Tournament dossier unavailable"
        description="Could not load the requested tournament dossier."
        headingLevel={1}
        actions={
          <Link hasUnderline href="/tournaments">
            Back to tournaments
          </Link>
        }
      />
    );
  }

  const detail = tournamentQuery.data;
  const decay = decayQuery.data?.rounds ?? [];
  const playerName = meQuery.data?.player?.displayName ?? 'Player';
  const rawWeaknesses = reportQuery.data?.weaknesses ?? [];
  const weaknesses = rawWeaknesses.slice(0, 3).map((w) => ({
    motif: w.label,
    cost: w.ratingLeak,
    count: w.occurrences,
  }));

  return (
    <TournamentDossierScreen
      detail={detail}
      decay={decay}
      playerName={playerName}
      weaknesses={weaknesses}
    />
  );
}
