// Normalize names by removing non-alphanumeric chars and creating word tokens
export function normalizeName(name: string): Set<string> {
  const normalized = name.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  const tokens = normalized.split(/\s+/).filter((token) => token.length > 0);
  return new Set(tokens);
}

// Check if user tokens are a subset of PGN tokens (or vice versa for flexibility)
export function isNameMatch(userTokens: Set<string>, pgnTokens: Set<string>): boolean {
  if (userTokens.size === 0 || pgnTokens.size === 0) return false;

  const userIsSubset = Array.from(userTokens).every((token) => pgnTokens.has(token));
  const pgnIsSubset = Array.from(pgnTokens).every((token) => userTokens.has(token));

  return userIsSubset || pgnIsSubset;
}
