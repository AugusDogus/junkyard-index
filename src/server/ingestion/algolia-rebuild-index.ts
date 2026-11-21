import { and, eq, inArray } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionRun } from "~/schema";
import { AlgoliaError } from "./algolia-error";

interface RebuildDeletionClient {
  deleteIndex(params: { indexName: string }): Promise<{ taskID: number }>;
  waitForTask(params: { indexName: string; taskID: number }): Promise<unknown>;
}

export interface RebuildCleanupClient extends RebuildDeletionClient {
  listIndices(params: { page: number; hitsPerPage: number }): Promise<{
    items: Array<{
      name: string;
      updatedAt: string;
      primary?: string;
      replicas?: string[];
    }>;
    nbPages?: number;
  }>;
}

export function rebuildIndexName(runId: string, indexName: string): string {
  return `${indexName}__rebuild_${runId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

/**
 * `deleted` when the copy is gone (or never existed); `blocked` when the
 * Algolia app rejected the delete and the copy stays until a later cleanup.
 */
export type RebuildIndexDeletion = "deleted" | "blocked";

export async function deleteRebuildIndex(
  algolia: RebuildDeletionClient,
  indexName: string,
  runId: string,
): Promise<RebuildIndexDeletion> {
  const temporaryIndex = rebuildIndexName(runId, indexName);
  try {
    const deleted = await algolia.deleteIndex({ indexName: temporaryIndex });
    await algolia.waitForTask({
      indexName: temporaryIndex,
      taskID: deleted.taskID,
    });
    return "deleted";
  } catch (error) {
    const failure = AlgoliaError.classify(
      { operation: "deleteIndex", indexName: temporaryIndex },
      error,
    );
    // Moving an index removes the source. Deletion is also safe to retry.
    if (failure._tag === "NotFound") return "deleted";
    // A blocked app rejects every write. The copy is cleared before any reload,
    // and the next rebuild's start or the stale-rebuild sweep removes it once
    // Algolia accepts writes again.
    if (failure._tag === "SearchBackendBlocked") {
      console.warn(
        `Left temporary Algolia index ${temporaryIndex} in place; the next rebuild or the stale-rebuild sweep deletes it after the block lifts. ${failure.message}`,
      );
      return "blocked";
    }
    throw error;
  }
}

async function deleteIndexByName(
  algolia: RebuildDeletionClient,
  indexName: string,
): Promise<RebuildIndexDeletion> {
  try {
    const deleted = await algolia.deleteIndex({ indexName });
    await algolia.waitForTask({ indexName, taskID: deleted.taskID });
    return "deleted";
  } catch (error) {
    const failure = AlgoliaError.classify(
      { operation: "deleteIndex", indexName },
      error,
    );
    if (failure._tag === "NotFound") return "deleted";
    if (failure._tag === "SearchBackendBlocked") return "blocked";
    throw error;
  }
}

type RebuildContext = {
  database: LibSQLDatabase;
  algolia: RebuildDeletionClient;
  indexName: string;
  runId: string;
};

/** A failed load must restart from zero after its partial copy is removed. */
export async function discardFailedRebuild(
  params: RebuildContext,
): Promise<void> {
  const reset = await params.database
    .update(ingestionRun)
    .set({
      stage: "full_reindex_prepare",
      fullReindexCursor: null,
      lastProgressAt: new Date(),
    })
    .where(
      and(
        eq(ingestionRun.id, params.runId),
        eq(ingestionRun.status, "running"),
        eq(ingestionRun.activeSlot, 1),
        inArray(ingestionRun.stage, [
          "full_reindex_prepare",
          "full_reindex_load",
          "full_reindex_publish",
          "full_reindex_publish_failed",
        ]),
      ),
    );
  // Never delete a copy behind an unconfirmed move. It stays fenced and is
  // reconciled by publishFullReindexForRun before any other run can publish.
  if (reset.rowsAffected === 1) {
    await deleteRebuildIndex(params.algolia, params.indexName, params.runId);
  } else {
    await cleanupInactiveRunRebuild(params);
  }
}

/** Deletes a run's copy once the run no longer holds the commit. */
export async function cleanupInactiveRunRebuild(
  params: RebuildContext,
): Promise<RebuildIndexDeletion | "active"> {
  const [run] = await params.database
    .select({ activeSlot: ingestionRun.activeSlot })
    .from(ingestionRun)
    .where(eq(ingestionRun.id, params.runId))
    .limit(1);
  if (run && run.activeSlot === 1) return "active";
  return deleteRebuildIndex(params.algolia, params.indexName, params.runId);
}

/**
 * Deletes rebuild copies of runs that no longer hold the commit, and keeps the
 * live index, its replicas, unrelated indices and active runs' copies.
 */
async function deleteInactiveRebuildCopies(params: {
  database: LibSQLDatabase;
  algolia: RebuildCleanupClient;
  indexName: string;
  /** Only copies last updated before this time; null for every copy. */
  updatedBefore: number | null;
}): Promise<void> {
  const indices: Awaited<
    ReturnType<RebuildCleanupClient["listIndices"]>
  >["items"] = [];
  // Collect pages before deleting, since deletion can shift page boundaries.
  for (let page = 0; ; page += 1) {
    const result = await params.algolia.listIndices({ page, hitsPerPage: 100 });
    indices.push(...result.items);
    if (
      result.nbPages === undefined
        ? result.items.length < 100
        : page + 1 >= result.nbPages
    )
      break;
  }
  const replicas = new Set(
    indices
      .flatMap((index) => index.replicas ?? [])
      .map((name) => name.replace(/^virtual\((.*)\)$/, "$1")),
  );
  const prefix = `${params.indexName}__rebuild_`;
  // Inline rebuilds run only while publication is inline, when no search
  // projector generation loads: a copy one left (publication switched back
  // during its rebuild) counts toward the record cap and is removed. The
  // generation is discarded once the projector finds its copy gone.
  const generationPrefix = `${params.indexName}__generation_`;
  for (const index of indices) {
    if (
      index.name.startsWith(generationPrefix) &&
      index.primary === undefined &&
      !replicas.has(index.name)
    ) {
      await deleteIndexByName(params.algolia, index.name);
      continue;
    }
    if (
      !index.name.startsWith(prefix) ||
      index.primary !== undefined ||
      replicas.has(index.name)
    )
      continue;
    const suffix = index.name.slice(prefix.length);
    if (
      !/^[a-zA-Z0-9_-]+$/.test(suffix) ||
      (params.updatedBefore !== null &&
        !(Date.parse(index.updatedAt) < params.updatedBefore))
    )
      continue;
    const active = await params.database
      .select({ id: ingestionRun.id })
      .from(ingestionRun)
      .where(eq(ingestionRun.activeSlot, 1));
    if (
      active.some(
        (run) => rebuildIndexName(run.id, params.indexName) === index.name,
      )
    )
      continue;
    await deleteRebuildIndex(params.algolia, params.indexName, suffix);
  }
}

/** A completed daily pass catches copies left by crashes or manual abandonment. */
export async function cleanupStaleRebuildIndices(params: {
  database: LibSQLDatabase;
  algolia: RebuildCleanupClient;
  indexName: string;
  now?: Date;
}): Promise<void> {
  await deleteInactiveRebuildCopies({
    ...params,
    updatedBefore: (params.now ?? new Date()).getTime() - 24 * 60 * 60 * 1000,
  });
}

/**
 * Before a full rebuild copies the live index, removes every other run's
 * leftover copy, however recent. Live records, the new copy and leftovers
 * together would otherwise exceed the plan's record cap. Only the commit
 * holder rebuilds, so no inactive run's copy is in use.
 */
export async function clearLeftoverRebuildIndices(params: {
  database: LibSQLDatabase;
  algolia: RebuildCleanupClient;
  indexName: string;
}): Promise<void> {
  await deleteInactiveRebuildCopies({ ...params, updatedBefore: null });
}
