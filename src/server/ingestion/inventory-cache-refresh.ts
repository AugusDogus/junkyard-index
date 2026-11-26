import { and, eq, gt, isNotNull, isNull, max, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { ChangedInventorySources } from "~/lib/inventory-cache";
import { isIngestionSource } from "~/lib/ingestion-source";
import {
  ingestionProjectorCheckpoint,
  ingestionRun,
  yardSummary,
} from "~/schema";

// Holds the highest publication sequence the inventory caches were refreshed
// for (last_processed_change_id), and when that refresh read which yards had
// changed (last_success_at).
const CHECKPOINT_NAME = "inventory-cache-refresh";

/**
 * How far before the previous refresh's read an ended run still counts, in
 * case its end committed after a read stamped later. Counting a run twice
 * only rebuilds and expires its sources' yards once more. Content changes
 * need no margin: the summary store stamps them with the refresh's own time,
 * which that refresh records as its read.
 */
const RUN_MARGIN_MS = 30 * 60 * 1000;

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

/**
 * A run's accepted sources, or none when the stored list is unreadable: a
 * bad list only costs that run's sources an early expiry, never a refresh.
 */
function acceptedSourceList(value: string | null): string[] {
  if (value === null) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isIngestionSource) : [];
  } catch {
    return [];
  }
}

export const InventoryCacheRefresh = {
  /**
   * Records that the caches show this publication, with every yard change
   * read up to `changesReadAt`; never moves backward.
   */
  async record(
    database: LibSQLDatabase,
    publicationSequence: number,
    changesReadAt: Date,
  ): Promise<void> {
    const updatedAt = new Date();
    await database
      .insert(ingestionProjectorCheckpoint)
      .values({
        name: CHECKPOINT_NAME,
        lastProcessedChangeId: publicationSequence,
        lastSuccessAt: changesReadAt,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: ingestionProjectorCheckpoint.name,
        set: {
          lastProcessedChangeId: publicationSequence,
          lastSuccessAt: changesReadAt,
          updatedAt,
        },
        setWhere: sql`${ingestionProjectorCheckpoint.lastProcessedChangeId} < ${publicationSequence}`,
      });
  },

  /** When the last refresh read which yards had changed, if one did. */
  async changesReadAt(database: LibSQLDatabase): Promise<Date | null> {
    const [checkpoint] = await database
      .select({ changesReadAt: ingestionProjectorCheckpoint.lastSuccessAt })
      .from(ingestionProjectorCheckpoint)
      .where(eq(ingestionProjectorCheckpoint.name, CHECKPOINT_NAME));
    return checkpoint?.changesReadAt ?? null;
  },

  /**
   * The sources of runs that ended without publishing since `since`, sorted.
   * Such a run may have written some vehicles before stopping, while
   * yard_inventory still names the previous publication.
   */
  async unpublishedSources(
    database: LibSQLDatabase,
    since: Date,
  ): Promise<string[]> {
    const runs = await database
      .select({ acceptedSources: ingestionRun.acceptedSources })
      .from(ingestionRun)
      .where(
        and(
          isNull(ingestionRun.activeSlot),
          gt(
            ingestionRun.completedAt,
            new Date(since.getTime() - RUN_MARGIN_MS),
          ),
          isNotNull(ingestionRun.acceptedSources),
          isNull(ingestionRun.inventoryPublishedAt),
        ),
      );
    const sources = new Set<string>();
    for (const { acceptedSources } of runs) {
      for (const source of acceptedSourceList(acceptedSources)) {
        sources.add(source);
      }
    }
    return [...sources].sort();
  },

  /**
   * What may have changed since `since`, or everything when no earlier read
   * is recorded:
   * - yards whose vehicles changed what their pages show, as the yard
   *   summary store found when it rebuilt their summaries;
   * - every yard of the sources of a run that ended without publishing,
   *   which may have written some vehicles before stopping (the store
   *   rebuilds their summaries too).
   * A publication that changed nothing a yard shows leaves its pages cached.
   * So does one whose summary the store failed to rebuild: its pages and
   * stored summary still agree, and the next refresh rebuilds it and finds
   * what changed.
   */
  async changedSources(
    database: LibSQLDatabase,
    since: Date | null,
  ): Promise<ChangedInventorySources> {
    if (since === null) return { kind: "all" };
    const [contentChanged, sources] = await Promise.all([
      database
        .select({ source: yardSummary.source, code: yardSummary.locationCode })
        .from(yardSummary)
        .where(gt(yardSummary.contentChangedAt, since)),
      InventoryCacheRefresh.unpublishedSources(database, since),
    ]);
    const yards = new Map(
      contentChanged
        .filter(({ source }) => !sources.includes(source))
        .map((yard) => [`${yard.source}:${yard.code}`, yard] as const),
    );
    return {
      kind: "sources",
      sources,
      yards: [...yards]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([, yard]) => yard),
    };
  },

  /**
   * Only for a publication newer than the caches or their stored data show:
   * stores the data if it is behind, then revalidates the caches.
   */
  async run(params: {
    database: LibSQLDatabase;
    source: InventoryCacheSource;
    /** Expires the caches: all directory entries, and `changed` sources'. */
    revalidate: (changed: ChangedInventorySources) => void;
    now: Date;
  }): Promise<InventoryCacheRefresh> {
    const [[state], [checkpoint], projected] = await Promise.all([
      params.database
        .select({ latest: max(ingestionRun.publicationSequence) })
        .from(ingestionRun),
      params.database
        .select({
          refreshed: ingestionProjectorCheckpoint.lastProcessedChangeId,
          changesReadAt: ingestionProjectorCheckpoint.lastSuccessAt,
        })
        .from(ingestionProjectorCheckpoint)
        .where(eq(ingestionProjectorCheckpoint.name, CHECKPOINT_NAME)),
      params.source.projectedThrough(),
    ]);
    const latest = state?.latest ?? null;
    if (
      latest === null ||
      (latest <= (checkpoint?.refreshed ?? 0) && latest <= projected)
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
      params.revalidate(
        await InventoryCacheRefresh.changedSources(
          params.database,
          checkpoint?.changesReadAt ?? null,
        ),
      );
    } catch (error) {
      return {
        status: "failed",
        stage: "revalidate",
        publicationSequence: latest,
        error,
      };
    }
    await InventoryCacheRefresh.record(params.database, latest, params.now);
    return { status: "refreshed", publicationSequence: latest };
  },
} as const;
