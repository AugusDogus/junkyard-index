import { eq, max, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionProjectorCheckpoint, ingestionRun } from "~/schema";

// Holds the highest publication sequence the inventory caches were refreshed for.
const CHECKPOINT_NAME = "inventory-cache-refresh";

/**
 * Refreshing inventory caches after a pass. Current: the caches already show
 * the latest publication. Failed: storing what the caches read (`project`) or
 * revalidating them threw, and the checkpoint stays behind so the next pass
 * retries. Next's revalidateTag only queues the tag and writes it after the
 * step returns, so a failed write there goes unseen here and falls back to
 * the caches' daily expiry.
 */
export type InventoryCacheRefresh =
  | { status: "current" }
  | { status: "refreshed"; publicationSequence: number }
  | {
      status: "failed";
      stage: "project" | "revalidate";
      publicationSequence: number;
      error: unknown;
    };

/**
 * What the caches read, stored once per publication with a checkpoint of its
 * own. It can be ahead of the caches (a deploy stored it) or behind them (a
 * deployment that did not store it refreshed them).
 */
export type InventoryCacheSource = {
  /** The publication the stored data reflects. */
  projectedThrough: () => Promise<number>;
  /** Stores the data for the latest publication. Reads every vehicle. */
  project: () => Promise<void>;
};

export const InventoryCacheRefresh = {
  /** Records that the caches show this publication; never moves backward. */
  async record(
    database: LibSQLDatabase,
    publicationSequence: number,
  ): Promise<void> {
    const updatedAt = new Date();
    await database
      .insert(ingestionProjectorCheckpoint)
      .values({
        name: CHECKPOINT_NAME,
        lastProcessedChangeId: publicationSequence,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: ingestionProjectorCheckpoint.name,
        set: { lastProcessedChangeId: publicationSequence, updatedAt },
        setWhere: sql`${ingestionProjectorCheckpoint.lastProcessedChangeId} < ${publicationSequence}`,
      });
  },

  /**
   * Only for a publication newer than the caches or their stored data show:
   * stores the data if it is behind, then revalidates the caches.
   */
  async run(params: {
    database: LibSQLDatabase;
    source: InventoryCacheSource;
    revalidate: () => void;
  }): Promise<InventoryCacheRefresh> {
    const [[state], projected] = await Promise.all([
      params.database
        .select({
          latest: max(ingestionRun.publicationSequence),
          refreshed: sql<number | null>`(
            select ${ingestionProjectorCheckpoint.lastProcessedChangeId}
            from ${ingestionProjectorCheckpoint}
            where ${eq(ingestionProjectorCheckpoint.name, CHECKPOINT_NAME)}
          )`,
        })
        .from(ingestionRun),
      params.source.projectedThrough(),
    ]);
    const latest = state?.latest ?? null;
    if (
      latest === null ||
      (latest <= (state?.refreshed ?? 0) && latest <= projected)
    ) {
      return { status: "current" };
    }
    if (latest > projected) {
      try {
        await params.source.project();
      } catch (error) {
        return {
          status: "failed",
          stage: "project",
          publicationSequence: latest,
          error,
        };
      }
    }
    try {
      params.revalidate();
    } catch (error) {
      return {
        status: "failed",
        stage: "revalidate",
        publicationSequence: latest,
        error,
      };
    }
    await InventoryCacheRefresh.record(params.database, latest);
    return { status: "refreshed", publicationSequence: latest };
  },
} as const;
