import type { HollanderstoresPage } from "./hollanderstores-parser";

/** Bound identity turnover, not just net count change. The saved drift-history
 * captures lose 1-3 vehicles per yard. Allow 3 or 1% (rounded down), whichever
 * is larger, while retaining the fully enumerated opening set for publication.
 */
export function hollanderstoresCensusError(
  opening: HollanderstoresPage,
  closing: HollanderstoresPage,
): string | null {
  const openingUrls = new Set(opening.rows.map((row) => row.url));
  const closingUrls = new Set(closing.rows.map((row) => row.url));
  const removed = opening.rows.filter((row) => !closingUrls.has(row.url));
  const added = closing.rows.filter((row) => !openingUrls.has(row.url));
  const limit = Math.max(3, Math.floor(opening.total * 0.01));
  if (removed.length + added.length > limit)
    return `${opening.yard} closing census drift exceeds ${limit} vehicles: ${removed.length} removed, ${added.length} added (${opening.total} opening, ${closing.total} closing). Previous inventory and the last validated checkpoint are preserved. Inspect the captures and restart with a fresh opening census.`;
  // Turnover may add or remove rows, but surviving records must retain their
  // fields, destinations and relative order. Reordered duplicate stocks remain
  // unqualified, as in the saved OK Auto Parts captures.
  if (
    JSON.stringify(opening.rows.filter((row) => closingUrls.has(row.url))) !==
    JSON.stringify(closing.rows.filter((row) => openingUrls.has(row.url)))
  )
    return `${opening.yard} closing census changed surviving vehicle fields or order. Previous inventory and the last validated checkpoint are preserved. Inspect the captures and restart with a fresh opening census.`;
  return null;
}
