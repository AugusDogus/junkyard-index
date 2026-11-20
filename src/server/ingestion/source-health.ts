import {
  ACTIVE_INGESTION_SOURCES,
  INGESTION_SOURCE_DISPLAY_NAMES,
  type IngestionSource,
} from "~/lib/ingestion-source";
import {
  isFreshPublication,
  SOURCE_STALE_AFTER_HOURS,
  type IngestionSourceFreshness,
} from "./durable-health";

export interface StaleSource {
  source: IngestionSource;
  name: string;
  /** Null when no accepted publication falls in the freshness query's lookback. */
  lastPublishedAt: Date | null;
}

export interface SourceHealth {
  status: "healthy" | "stale";
  staleAfterHours: number;
  /** Active sources that are not paused, so are expected to publish. */
  checked: number;
  /** Active sources paused by their Vercel flag; not checked. */
  paused: IngestionSource[];
  stale: StaleSource[];
}

export const SourceHealth = {
  /**
   * Whether every active, unpaused source has an accepted publication within
   * `SOURCE_STALE_AFTER_HOURS`. Retired sources are never checked.
   */
  evaluate(
    recent: readonly IngestionSourceFreshness[],
    enabled: readonly IngestionSource[],
    now: Date,
  ): SourceHealth {
    const lastPublished = new Map(
      recent.map((row) => [row.source, row.lastPublishedAt]),
    );
    const checked = ACTIVE_INGESTION_SOURCES.filter((source) =>
      enabled.includes(source),
    );
    const stale = checked.flatMap((source): StaleSource[] => {
      const lastPublishedAt = lastPublished.get(source) ?? null;
      if (isFreshPublication(lastPublishedAt, now)) return [];
      return [
        {
          source,
          name: INGESTION_SOURCE_DISPLAY_NAMES[source],
          lastPublishedAt:
            lastPublishedAt === null ? null : new Date(lastPublishedAt),
        },
      ];
    });
    return {
      status: stale.length === 0 ? "healthy" : "stale",
      staleAfterHours: SOURCE_STALE_AFTER_HOURS,
      checked: checked.length,
      paused: ACTIVE_INGESTION_SOURCES.filter(
        (source) => !enabled.includes(source),
      ),
      stale,
    };
  },
} as const;
