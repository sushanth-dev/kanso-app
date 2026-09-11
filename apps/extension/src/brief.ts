/**
 * ST-153. The brief's shape, validated rather than trusted.
 *
 * The endpoint serves exactly two keys at the top and three inside each
 * group; anything else, malformed or missing, is treated as "no brief" and
 * the card says nothing. The validator is the extension's whole trust
 * boundary: it never renders a field it has not checked.
 */
export interface BriefGroup {
  label: string;
  stream: string;
  weekCount: number;
}

export interface Brief {
  groups: BriefGroup[];
  focusLabel: string | null;
}

export function isBrief(value: unknown): value is Brief {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.focusLabel !== null && typeof record.focusLabel !== 'string') return false;
  if (!Array.isArray(record.groups)) return false;
  return record.groups.every((group) => {
    if (typeof group !== 'object' || group === null) return false;
    const g = group as Record<string, unknown>;
    return (
      typeof g.label === 'string' && typeof g.stream === 'string' && Number.isInteger(g.weekCount)
    );
  });
}
