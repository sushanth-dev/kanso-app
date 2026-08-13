import { describe, expect, test } from 'vitest';
import { isLocalhostDatabaseUrl } from './localhost.ts';

describe('isLocalhostDatabaseUrl', () => {
  test('accepts a localhost database url', () => {
    expect(isLocalhostDatabaseUrl('postgresql://postgres:postgres@localhost:5433/kanso_dev')).toBe(
      true,
    );
  });

  test('accepts loopback addresses', () => {
    expect(isLocalhostDatabaseUrl('postgresql://postgres:postgres@127.0.0.1:5432/x')).toBe(true);
    expect(isLocalhostDatabaseUrl('postgresql://user:password@[::1]:5432/x')).toBe(true);
  });

  test('refuses a non-local host', () => {
    expect(isLocalhostDatabaseUrl('postgresql://user:pass@kanso.rds.amazonaws.com:5432/db')).toBe(
      false,
    );
  });

  test('refuses a malformed url', () => {
    expect(isLocalhostDatabaseUrl('not a url')).toBe(false);
  });
});
