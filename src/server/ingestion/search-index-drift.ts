import { count, eq } from "drizzle-orm";
import { Effect } from "effect";
import { ingestionProjectorCheckpoint, vehicle } from "~/schema";
import type { AlgoliaError } from "./algolia-error";
import { IngestionDay } from "./ingestion-day";
import { SearchIndexGenerations } from "./search-index-generation";
import type { SearchProjectorContext } from "./search-projection-batch";

const CHECKPOINT_NAME = "search-projector:drift";
/** An automatic rebuild for drift at most this often. */
export const DRIFT_REBUILD_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How far the live index's record count may differ from the `vehicle`
 * table before it counts as drift. The index holds every vehicle row,
 * missing ones in their grace period included, so the counts match once the
 * projector is caught up; the band absorbs records Algolia is still applying.
 */
export function driftTolerance(vehicles: number): number {
  return Math.max(100, Math.ceil(vehicles * 0.005));
}

/** A daily drift check's outcome. */
export type SearchIndexDriftResult = {
  status: "drift_checked";
  /** IngestionDay key. */
  day: string;
  /** Records in the live index (listIndices `entries`). */
  entries: number;
  /** Rows in `vehicle`, live and missing. */
  vehicles: number;
  drifted: boolean;
  /** Daily checks in a row that found drift. */
  consecutiveDrifts: number;
  /** The rebuild this check requested, if it requested one. */
  rebuildRequested: string | null;
};

/**
 * A daily check that the live index holds as many records as Turso has
 * vehicles. It costs one listIndices call and no search. Drift requests a
 * rebuild at most once every 7 days; drift found two days in a row fails
 * the projector's tick, so it pages instead of rebuilding again.
 */
export const SearchIndexDrift = {
  checkpointName: CHECKPOINT_NAME,

  /** Whether today's check has not run yet. */
  async due(
    database: SearchProjectorContext["database"],
    now: Date,
  ): Promise<boolean> {
    const [row] = await database
      .select({ jobDay: ingestionProjectorCheckpoint.jobDay })
      .from(ingestionProjectorCheckpoint)
      .where(eq(ingestionProjectorCheckpoint.name, CHECKPOINT_NAME))
      .limit(1);
    return row?.jobDay !== IngestionDay.key(now);
  },

  check(
    context: SearchProjectorContext,
  ): Effect.Effect<SearchIndexDriftResult, AlgoliaError> {
    return Effect.gen(function* () {
      const now = context.now();
      const day = IngestionDay.key(now);
      const listing = yield* context.writer.listIndices();
      const entries =
        listing.find((index) => index.name === context.indexName)?.entries ?? 0;
      const [counted] = yield* Effect.promise(() =>
        context.database.select({ vehicles: count() }).from(vehicle),
      );
      const vehicles = counted?.vehicles ?? 0;
      const drifted = Math.abs(entries - vehicles) > driftTolerance(vehicles);
      const [previous] = yield* Effect.promise(() =>
        context.database
          .select({ failureCount: ingestionProjectorCheckpoint.failureCount })
          .from(ingestionProjectorCheckpoint)
          .where(eq(ingestionProjectorCheckpoint.name, CHECKPOINT_NAME))
          .limit(1),
      );
      const consecutiveDrifts = drifted ? (previous?.failureCount ?? 0) + 1 : 0;
      let rebuildRequested: string | null = null;
      if (drifted) {
        const last = yield* Effect.promise(() =>
          SearchIndexGenerations.lastRequestedAt(context.database, {
            environment: context.environment,
            reason: "drift",
          }),
        );
        if (
          last === null ||
          now.getTime() - last.getTime() >= DRIFT_REBUILD_INTERVAL_MS
        ) {
          const request = yield* Effect.promise(() =>
            SearchIndexGenerations.request(context.database, {
              environment: context.environment,
              indexName: context.indexName,
              reason: "drift",
              now,
            }),
          );
          rebuildRequested = request.status === "requested" ? request.id : null;
        }
      }
      const state = {
        kind: "daily",
        jobDay: day,
        jobCursor: JSON.stringify({ entries, vehicles }),
        failureCount: consecutiveDrifts,
        lastErrorTag: drifted ? "Drift" : null,
        lastSuccessAt: now,
        updatedAt: now,
      };
      yield* Effect.promise(() =>
        context.database
          .insert(ingestionProjectorCheckpoint)
          .values({ name: CHECKPOINT_NAME, lastProcessedChangeId: 0, ...state })
          .onConflictDoUpdate({
            target: ingestionProjectorCheckpoint.name,
            set: state,
          }),
      );
      if (drifted) {
        console.error(
          `[Search] Live index ${context.indexName} holds ${entries} records but Turso has ${vehicles} vehicles (tolerance ${driftTolerance(vehicles)}); drift found ${consecutiveDrifts} day(s) in a row. ${rebuildRequested === null ? "No rebuild was requested: one for drift ran within 7 days. Investigate the projector before requesting one." : `Rebuild ${rebuildRequested} was requested.`}`,
        );
      }
      return {
        status: "drift_checked",
        day,
        entries,
        vehicles,
        drifted,
        consecutiveDrifts,
        rebuildRequested,
      } as const;
    });
  },
} as const;
