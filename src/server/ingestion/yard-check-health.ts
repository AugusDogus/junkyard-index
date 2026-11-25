import {
  ACTIVE_INGESTION_SOURCES,
  INGESTION_SOURCE_DISPLAY_NAMES,
  type IngestionSource,
} from "~/lib/ingestion-source";
import {
  INVENTORY_STALE_AFTER_HOURS,
  InventoryStaleness,
} from "~/lib/inventory-staleness";
import type { YardCheckOutcome } from "~/lib/yard-check";

/** A yard with at least this many cars and no change is reported as frozen. */
export const FROZEN_YARD_MIN_VEHICLES = 100;
/** Days without any inventory change before a checked yard counts as frozen. */
export const FROZEN_YARD_AFTER_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One listed yard and its check record, if it has one yet. Times are epoch
 * milliseconds so the row survives the status routes' JSON cache.
 */
export interface YardCheckRow {
  source: string;
  locationCode: string;
  vehicleCount: number;
  outcome: YardCheckOutcome | null;
  lastCheckedAt: number | null;
  lastChangedAt: number | null;
  consecutiveUncheckedRuns: number;
}

export interface UncheckedYard {
  source: IngestionSource;
  name: string;
  code: string;
  vehicleCount: number;
  /** The latest accepted run's result for the yard. */
  outcome: YardCheckOutcome;
  /** Null when no run has fetched it since tracking began. */
  lastCheckedAt: Date | null;
  consecutiveUncheckedRuns: number;
}

export interface FrozenYard {
  source: IngestionSource;
  name: string;
  code: string;
  vehicleCount: number;
  lastCheckedAt: Date;
  lastChangedAt: Date;
}

/**
 * Per-yard alerts next to the per-source health check.
 * - notChecked: listed yards of unpaused sources with no live fetch within
 *   INVENTORY_STALE_AFTER_HOURS whose source reports per-yard results (the
 *   yard was blocked, preserved or replayed). Any makes the status degraded.
 * - unreported: the same, for yards whose latest result was unreported, so
 *   no run proves a check either way.
 * - frozen: information, not an outage. Yards fetched within the window with
 *   FROZEN_YARD_MIN_VEHICLES or more cars whose inventory has not changed in
 *   FROZEN_YARD_AFTER_DAYS: the yard's own feed may have stopped updating.
 * - autoHide: what the 7-day hide would do per yard, with the outage guard
 *   (OUTAGE_STALE_SHARE of checked yards not current holds every yard). It
 *   is reported only; listings still hide whole sources.
 */
export interface YardCheckHealth {
  staleAfterHours: number;
  /** Listed yards of unpaused active sources. */
  checked: number;
  notChecked: UncheckedYard[];
  unreported: UncheckedYard[];
  frozen: FrozenYard[];
  autoHide:
    | { status: "applied"; yards: string[] }
    | { status: "outage"; stale: number; checked: number; held: string[] };
}

function isActive(source: string): source is IngestionSource {
  return ACTIVE_INGESTION_SOURCES.some((active) => active === source);
}

export const YardCheckHealth = {
  evaluate(
    rows: readonly YardCheckRow[],
    enabled: readonly IngestionSource[],
    now: Date,
  ): YardCheckHealth {
    const at = now.getTime();
    const listed = rows.flatMap((row) =>
      isActive(row.source) && enabled.includes(row.source)
        ? [{ ...row, source: row.source }]
        : [],
    );
    const notChecked: UncheckedYard[] = [];
    const unreported: UncheckedYard[] = [];
    const frozen: FrozenYard[] = [];
    const due: string[] = [];
    let stale = 0;
    for (const row of listed) {
      const name = INGESTION_SOURCE_DISPLAY_NAMES[row.source];
      const key = `${row.source}:${row.locationCode}`;
      const staleness = InventoryStaleness.of(row.lastCheckedAt, at);
      if (staleness.kind !== "current") {
        stale += 1;
        if (staleness.kind === "hidden") due.push(key);
        const yard: UncheckedYard = {
          source: row.source,
          name,
          code: row.locationCode,
          vehicleCount: row.vehicleCount,
          outcome: row.outcome ?? "unreported",
          lastCheckedAt:
            row.lastCheckedAt === null ? null : new Date(row.lastCheckedAt),
          consecutiveUncheckedRuns: row.consecutiveUncheckedRuns,
        };
        if (yard.outcome === "unreported") unreported.push(yard);
        else notChecked.push(yard);
      } else if (
        row.lastCheckedAt !== null &&
        row.lastChangedAt !== null &&
        row.vehicleCount >= FROZEN_YARD_MIN_VEHICLES &&
        at - row.lastChangedAt >= FROZEN_YARD_AFTER_DAYS * DAY_MS
      ) {
        frozen.push({
          source: row.source,
          name,
          code: row.locationCode,
          vehicleCount: row.vehicleCount,
          lastCheckedAt: new Date(row.lastCheckedAt),
          lastChangedAt: new Date(row.lastChangedAt),
        });
      }
    }
    return {
      staleAfterHours: INVENTORY_STALE_AFTER_HOURS,
      checked: listed.length,
      notChecked,
      unreported,
      frozen,
      autoHide:
        listed.length > 0 &&
        stale >= InventoryStaleness.outageAfterStale(listed.length)
          ? { status: "outage", stale, checked: listed.length, held: due }
          : { status: "applied", yards: due },
    };
  },
} as const;
