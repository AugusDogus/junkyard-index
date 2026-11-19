export type VinClaim = { vin: string; signature: string };

/**
 * VINs claimed by rows with different native signatures. Callers quarantine
 * every row of such a VIN: native stocks and row order are never tie-breakers.
 * Rows whose signatures agree are benign duplicates, not conflicts.
 */
export function conflictingVins<T>(
  rows: Iterable<T>,
  claim: (row: T) => VinClaim | null,
): ReadonlySet<string> {
  const signatures = new Map<string, Set<string>>();
  for (const row of rows) {
    const claimed = claim(row);
    if (claimed === null) continue;
    const group = signatures.get(claimed.vin) ?? new Set<string>();
    group.add(claimed.signature);
    signatures.set(claimed.vin, group);
  }
  return new Set(
    [...signatures].filter(([, group]) => group.size > 1).map(([vin]) => vin),
  );
}
