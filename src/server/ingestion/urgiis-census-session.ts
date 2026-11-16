import { Effect } from "effect";
import { UrgiisCensus } from "./urgiis-census";
import { UrgiisCursor } from "./urgiis-cursor";
import { urgiisError } from "./urgiis-client";
import { urgiisFingerprint } from "./urgiis-traversal";
import type { UrgiisTenant } from "./urgiis-tenant";

export interface UrgiisCensusHistory {
  previousCursor?: unknown;
  /** In-memory equivalent of private Blob state for offline runners. */
  censusState?: unknown;
  loadCensus?: (path: string) => Promise<unknown>;
}

/** Previous published state may cold-fallback. Active state must remain intact:
 * it can already have contributed carried donors to this run's checkpoint. */
export function resumeUrgiisCensus(
  initial: UrgiisCursor,
  tenants: readonly UrgiisTenant[],
  now: number,
  history: UrgiisCensusHistory,
) {
  return Effect.gen(function* () {
    let cursor = initial;
    let census = UrgiisCensus.empty();
    const warnings: string[] = [];
    const load = (path: string, hash: string) =>
      Effect.tryPromise({
        try: async () => {
          if (!history.loadCensus && history.censusState === undefined)
            throw new Error("IIS census loader is unavailable");
          const input =
            history.censusState ?? (await history.loadCensus?.(path));
          const state = UrgiisCensus.parse(input, tenants, now);
          if (urgiisFingerprint(state) !== hash)
            throw new Error("IIS census checksum changed");
          return state;
        },
        catch: (cause) => urgiisError("load accepted census", cause),
      });
    if (cursor.startedAt === null) {
      // The durable adapter supplies only an accepted, search-published cursor.
      const previous = yield* Effect.try({
        try: () =>
          history.previousCursor
            ? UrgiisCursor.parse(history.previousCursor, tenants)
            : null,
        catch: (cause) => urgiisError("previous census", cause),
      }).pipe(Effect.either);
      let statePath: string | null = null;
      if (
        previous._tag === "Right" &&
        previous.right?.phase === "complete" &&
        previous.right.statePath &&
        previous.right.stateHash
      ) {
        const loaded = yield* load(
          previous.right.statePath,
          previous.right.stateHash,
        ).pipe(Effect.either);
        if (loaded._tag === "Right") {
          census = loaded.right;
          statePath = previous.right.statePath;
        } else warnings.push(loaded.left.message + " Starting a full census.");
      } else if (history.previousCursor) {
        warnings.push(
          "Previous IIS census is incompatible or incomplete; starting a full census.",
        );
      }
      cursor = yield* Effect.try({
        try: () =>
          UrgiisCursor.checkpoint(
            {
              ...cursor,
              startedAt: now,
              asOf: now,
              statePath,
              stateHash: census.tenants.length
                ? urgiisFingerprint(census)
                : null,
            },
            tenants,
          ),
        catch: (cause) => urgiisError("begin census", cause),
      });
    } else if (cursor.stateHash) {
      census = yield* load(cursor.statePath ?? "", cursor.stateHash);
    }
    if (cursor.asOf !== null && now < cursor.asOf)
      return yield* Effect.fail(
        urgiisError(
          "census clock",
          "Run time moved backwards; restart this run",
        ),
      );
    return { cursor, census, warnings };
  });
}
