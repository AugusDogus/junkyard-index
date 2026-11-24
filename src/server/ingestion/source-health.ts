import {
  ACTIVE_INGESTION_SOURCES,
  INGESTION_SOURCE_DISPLAY_NAMES,
  type IngestionSource,
} from "~/lib/ingestion-source";
import { InventoryStaleness } from "~/lib/inventory-staleness";
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
  /** "degraded": some sources are stale, fewer than `outageAfterStale`. */
  status: "healthy" | "degraded" | "stale";
  staleAfterHours: number;
  /** Active sources that are not paused, so are expected to publish. */
  checked: number;
  /** How many stale sources make the status "stale". */
  outageAfterStale: number;
  /** Active sources paused by their Vercel flag; not checked. */
  paused: IngestionSource[];
  stale: StaleSource[];
}

export const SourceHealth = {
  /**
   * Which active, unpaused sources lack an accepted publication within
   * `SOURCE_STALE_AFTER_HOURS`, and whether enough are stale to count as an
   * ingestion outage. Retired sources are never checked.
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
    // OUTAGE_STALE_SHARE of them: fewer stale sources are individual
    // provider failures, listed but not failing the check. The automatic
    // 7-day hide stops at the same share, of every active source, paused
    // or not (docs/runbooks/hide-source.md).
    const outageAfterStale = InventoryStaleness.outageAfterStale(
      checked.length,
    );
    return {
      status:
        stale.length === 0
          ? "healthy"
          : stale.length >= outageAfterStale
            ? "stale"
            : "degraded",
      staleAfterHours: SOURCE_STALE_AFTER_HOURS,
      checked: checked.length,
      outageAfterStale,
      paused: ACTIVE_INGESTION_SOURCES.filter(
        (source) => !enabled.includes(source),
      ),
      stale,
    };
  },
} as const;
