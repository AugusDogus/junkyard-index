import { unstable_cache } from "next/cache";
import { db } from "~/lib/db";
import { loadYardCheckRows } from "~/server/ingestion/yard-check-rows";

// Yard checks change once per accepted publication; the status endpoints
// share one read per 10 minutes, like source freshness.
export const getCachedYardCheckRows = unstable_cache(
  () => loadYardCheckRows(db),
  ["yard-check-rows-v1"],
  { revalidate: 600 },
);
