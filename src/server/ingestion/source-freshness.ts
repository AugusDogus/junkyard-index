import { db } from "~/lib/db";
import {
  loadSourceFreshness,
  type IngestionSourceFreshness,
} from "./durable-health";

/**
 * Each source's latest attempt and accepted publication within the longest
 * source look-back (`sourcePublicationLookbackMs`: 5 days, for U Pull R Parts'
 * every-third-day cadence), from this deployment's database. Callers apply
 * each source's own look-back or staleness threshold. Pages and status routes read it without
 * loading the ingestion runtime (connectors, Blob, search clients).
 */
export function getSourceFreshness(
  now: Date,
): Promise<IngestionSourceFreshness[]> {
  return loadSourceFreshness(db, now);
}
