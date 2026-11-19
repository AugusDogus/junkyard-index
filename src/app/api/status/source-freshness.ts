import { unstable_cache } from "next/cache";
import { getDurableSourceFreshness } from "~/server/ingestion/durable-ingestion";

// Better Stack polls the status endpoints every few minutes, and sources
// publish once a day. One query per 10 minutes serves them all; a stale flip
// lags by at most that.
export const getCachedSourceFreshness = unstable_cache(
  () => getDurableSourceFreshness(new Date()),
  ["durable-source-freshness"],
  { revalidate: 600 },
);
