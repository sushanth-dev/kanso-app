import { describe, expect, test } from 'vitest';
import {
  belongsToTournament,
  identityOf,
  normaliseEventName,
  normaliseSite,
  TOURNAMENT_WINDOW_DAYS,
} from './identity.ts';

const day = (iso: string): Date => new Date(iso);

describe('normaliseEventName', () => {
  test('lowercases, trims, and collapses whitespace', () => {
    expect(normaliseEventName('  Autumn   Open 2025 ')).toBe('autumn open 2025');
  });

  test('is null for a missing or whitespace-only name', () => {
    expect(normaliseEventName(null)).toBeNull();
    expect(normaliseEventName('   ')).toBeNull();
  });
});

describe('normaliseSite', () => {
  test('normalises like the event name', () => {
    expect(normaliseSite('  Riga   LAT ')).toBe('riga lat');
  });

  test('is null for a missing or whitespace-only site', () => {
    expect(normaliseSite(null)).toBeNull();
    expect(normaliseSite('   ')).toBeNull();
  });
});

describe('identityOf', () => {
  test('derives a key and site from the raw tags', () => {
    expect(identityOf('Autumn Open 2025', 'Riga LAT')).toEqual({
      key: 'autumn open 2025',
      site: 'riga lat',
    });
  });

  test('has a null key when the event normalises to nothing', () => {
    expect(identityOf(null, 'Riga LAT').key).toBeNull();
    expect(identityOf('   ', 'Riga LAT').key).toBeNull();
  });
});

describe('belongsToTournament', () => {
  const tournament = {
    key: 'autumn open 2025',
    site: 'riga lat',
    startedAt: day('2025-10-10T00:00:00Z'),
    endedAt: day('2025-10-12T00:00:00Z'),
  };

  test('joins two games at the same event in the same week into one tournament', () => {
    expect(
      belongsToTournament(
        { event: 'Autumn Open 2025', site: 'Riga LAT', playedAt: day('2025-10-11T00:00:00Z') },
        tournament,
      ),
    ).toBe(true);
  });

  test('separates two games at the same event a year apart into two tournaments', () => {
    // A game a year later is outside the 30-day window of either end.
    expect(
      belongsToTournament(
        { event: 'Autumn Open 2025', site: 'Riga LAT', playedAt: day('2026-10-11T00:00:00Z') },
        tournament,
      ),
    ).toBe(false);
  });

  test('separates two games at the same event in different years', () => {
    const lastYear = {
      key: 'autumn open 2024',
      site: 'riga lat',
      startedAt: day('2024-10-10T00:00:00Z'),
      endedAt: day('2024-10-12T00:00:00Z'),
    };
    expect(
      belongsToTournament(
        { event: 'Autumn Open 2025', site: 'Riga LAT', playedAt: day('2025-10-11T00:00:00Z') },
        lastYear,
      ),
    ).toBe(false);
  });

  test('treats two missing sites as equal', () => {
    expect(
      belongsToTournament(
        { event: 'Autumn Open 2025', site: null, playedAt: day('2025-10-11T00:00:00Z') },
        { ...tournament, site: null },
      ),
    ).toBe(true);
  });

  test('joins a game with no date on the identity alone', () => {
    expect(
      belongsToTournament(
        { event: 'Autumn Open 2025', site: 'Riga LAT', playedAt: null },
        tournament,
      ),
    ).toBe(true);
  });

  test('joins a game just inside the 30-day window of an end', () => {
    // 20 days after the end is within the window.
    expect(
      belongsToTournament(
        { event: 'Autumn Open 2025', site: 'Riga LAT', playedAt: day('2025-11-01T00:00:00Z') },
        tournament,
      ),
    ).toBe(true);
  });

  test('rejects a game just outside the 30-day window', () => {
    // 40 days after the end is outside the window.
    expect(
      belongsToTournament(
        { event: 'Autumn Open 2025', site: 'Riga LAT', playedAt: day('2025-11-21T00:00:00Z') },
        tournament,
      ),
    ).toBe(false);
  });

  test('rejects a different normalised event name', () => {
    expect(
      belongsToTournament(
        { event: 'Winter Open 2025', site: 'Riga LAT', playedAt: day('2025-10-11T00:00:00Z') },
        tournament,
      ),
    ).toBe(false);
  });

  test('rejects a different site', () => {
    expect(
      belongsToTournament(
        { event: 'Autumn Open 2025', site: 'Tallinn EST', playedAt: day('2025-10-11T00:00:00Z') },
        tournament,
      ),
    ).toBe(false);
  });

  test('never attaches a game whose event normalises to nothing', () => {
    expect(
      belongsToTournament(
        { event: null, site: 'Riga LAT', playedAt: day('2025-10-11T00:00:00Z') },
        tournament,
      ),
    ).toBe(false);
  });

  test('the window constant is 30 days', () => {
    expect(TOURNAMENT_WINDOW_DAYS).toBe(30);
  });
});
