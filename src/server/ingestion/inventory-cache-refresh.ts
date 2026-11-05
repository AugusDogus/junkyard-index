import { eq, max, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionProjectorCheckpoint, ingestionRun } from "~/schema";

// Holds the highest publication sequence the inventory caches were refreshed for.
const CHECKPOINT_NAME = "inventory-cache-refresh";

/**
 * Refreshing inventory caches after a pass. Current: the caches already show
 * the latest publication. Failed: revalidation threw, and the checkpoint stays
 * behind so the next pass retries. Next's revalidateTag only queues the tag
 * and writes it after the step returns, so a failed write there goes unseen
 * here and falls back to the caches' daily expiry.
 */
export type InventoryCacheRefresh =
  | { status: "current" }
  | { status: "refreshed"; publicationSequence: number }
  | { status: "failed"; publicationSequence: number; error: unknown };

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

  /** Revalidates the caches only if a newer publication exists than they show. */
  async run(params: {
    database: LibSQLDatabase;
    revalidate: () => void;
  }): Promise<InventoryCacheRefresh> {
    const [state] = await params.database
      .select({
        latest: max(ingestionRun.publicationSequence),
        refreshed: sql<number | null>`(
          select ${ingestionProjectorCheckpoint.lastProcessedChangeId}
          from ${ingestionProjectorCheckpoint}
          where ${eq(ingestionProjectorCheckpoint.name, CHECKPOINT_NAME)}
        )`,
      })
      .from(ingestionRun);
    const latest = state?.latest ?? null;
    if (latest === null || latest <= (state?.refreshed ?? 0)) {
      return { status: "current" };
    }
    try {
      params.revalidate();
    } catch (error) {
      return { status: "failed", publicationSequence: latest, error };
    }
    await InventoryCacheRefresh.record(params.database, latest);
    return { status: "refreshed", publicationSequence: latest };
  },
} as const;
