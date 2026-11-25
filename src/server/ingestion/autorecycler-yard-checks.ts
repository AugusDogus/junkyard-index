import type { YardCheckReport } from "~/lib/yard-check";
import type { AutorecyclerCursor } from "./autorecycler-cursor";

/**
 * Each yard's result in a terminal AutoRecycler cursor. Every eligible yard
 * and every yard the snapshot lists came from this run's live freshness
 * search, Ario rank-window reads (replayed only from this run's own capture)
 * or global page crawl, so each is "fetched"; preserved yards keep their
 * previous inventory. AutoRecycler has no per-yard block: a block fails the
 * run. Empty for a cursor that is not terminal.
 */
export function autorecyclerYardChecks(
  cursor: AutorecyclerCursor,
  snapshotYards: Iterable<string>,
): YardCheckReport[] {
  if (cursor.phase !== "complete" || cursor.freshness === undefined) return [];
  const preserved = new Set(cursor.freshness.preservedYards ?? []);
  const codes = new Set([...cursor.freshness.eligibleYards, ...snapshotYards]);
  return [
    ...[...codes]
      .filter((code) => !preserved.has(code))
      .map((code) => ({ locationCode: code, outcome: "fetched" as const })),
    ...[...preserved].map((code) => ({
      locationCode: code,
      outcome: "preserved" as const,
    })),
  ];
}
