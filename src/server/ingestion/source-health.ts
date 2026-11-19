import {
  ACTIVE_INGESTION_SOURCES,
  INGESTION_SOURCE_DISPLAY_NAMES,
  type IngestionSource,
} from "~/lib/ingestion-source";
import {
  isFreshPublication,
  type IngestionSourceFreshness,
} from "./durable-health";

// Daily runs start at 07:00 UTC and publish within hours. 36 hours allows a
// late publication followed by an early one without flagging a healthy source,
// and still catches a source that misses a whole day.
const STALE_AFTER_HOURS = 36;

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
   * 36 hours. Retired sources are never checked.
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
      if (
        isFreshPublication(
          lastPublishedAt,
          now,
          STALE_AFTER_HOURS * 60 * 60 * 1000,
        )
      )
        return [];
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
      staleAfterHours: STALE_AFTER_HOURS,
      checked: checked.length,
      paused: ACTIVE_INGESTION_SOURCES.filter(
        (source) => !enabled.includes(source),
      ),
      stale,
    };
  },
} as const;
