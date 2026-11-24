import { db } from "~/lib/db";
import {
  loadSourceFreshness,
  type IngestionSourceFreshness,
} from "./durable-health";

/**
 * Each source's latest attempt and accepted publication in the last
 * SOURCE_FRESHNESS_LOOKBACK_DAYS, from this deployment's database. Pages and status routes read it without
 * loading the ingestion runtime (connectors, Blob, search clients).
 */
export function getSourceFreshness(
  now: Date,
): Promise<IngestionSourceFreshness[]> {
  return loadSourceFreshness(db, now);
}
