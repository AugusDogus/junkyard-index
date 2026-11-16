import { and, eq, inArray } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionRun } from "~/schema";

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

export async function deleteRebuildIndex(
  algolia: RebuildDeletionClient,
  indexName: string,
  runId: string,
): Promise<void> {
  const temporaryIndex = rebuildIndexName(runId, indexName);
  try {
    const deleted = await algolia.deleteIndex({ indexName: temporaryIndex });
    await algolia.waitForTask({
      indexName: temporaryIndex,
      taskID: deleted.taskID,
    });
  } catch (error) {
    // Moving an index removes the source. Deletion is also safe to retry.
    if (
      typeof error === "object" &&
      error !== null &&
      Reflect.get(error, "status") === 404
    )
      return;
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

export async function cleanupInactiveRunRebuild(
  params: RebuildContext,
): Promise<void> {
  const [run] = await params.database
    .select({ activeSlot: ingestionRun.activeSlot })
    .from(ingestionRun)
    .where(eq(ingestionRun.id, params.runId))
    .limit(1);
  if (run && run.activeSlot !== 1) {
    await deleteRebuildIndex(params.algolia, params.indexName, params.runId);
  }
}

/** A completed daily pass catches copies left by crashes or manual abandonment. */
export async function cleanupStaleRebuildIndices(params: {
  database: LibSQLDatabase;
  algolia: RebuildCleanupClient;
  indexName: string;
  now?: Date;
}): Promise<void> {
  const cutoff = (params.now ?? new Date()).getTime() - 24 * 60 * 60 * 1000;
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
  for (const index of indices) {
    if (
      !index.name.startsWith(prefix) ||
      index.primary !== undefined ||
      replicas.has(index.name)
    )
      continue;
    const suffix = index.name.slice(prefix.length);
    if (
      !/^[a-zA-Z0-9_-]+$/.test(suffix) ||
      !(Date.parse(index.updatedAt) < cutoff)
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
