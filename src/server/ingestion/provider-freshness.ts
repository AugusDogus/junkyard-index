import {
  INGESTION_SOURCE_DISPLAY_NAMES,
  INGESTION_SOURCES,
  type IngestionSource,
} from "~/lib/ingestion-source";
import {
  isFreshPublication,
  type IngestionSourceFreshness,
} from "./durable-health";

export interface ProviderFreshness {
  source: IngestionSource;
  name: string;
  fresh: boolean;
  lastPublishedAt: Date | null;
}

/**
 * Every source's freshness from its recent runs. A source with no accepted
 * publication in the window, including a disabled one, is stale.
 */
export function providerFreshness(
  recent: readonly IngestionSourceFreshness[],
  now: Date,
): ProviderFreshness[] {
  const bySource = new Map(recent.map((row) => [row.source, row]));
  return INGESTION_SOURCES.map((source) => {
    const lastPublishedAt = bySource.get(source)?.lastPublishedAt ?? null;
    return {
      source,
      name: INGESTION_SOURCE_DISPLAY_NAMES[source],
      fresh: isFreshPublication(lastPublishedAt, now),
      lastPublishedAt:
        lastPublishedAt === null ? null : new Date(lastPublishedAt),
    };
  });
}
