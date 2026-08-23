import { and, eq, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionRun, vehicleChange } from "~/schema";

export const INDEX_GENERATION_KEY = "junkyardIndexGeneration";

export interface ReindexAlgoliaClient {
  getSettings(params: { indexName: string }): Promise<{ userData?: unknown }>;
  operationIndex(params: {
    indexName: string;
    operationIndexParams: { operation: "move"; destination: string };
  }): Promise<{ taskID: number }>;
  waitForTask(params: { indexName: string; taskID: number }): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function indexGeneration(userData: unknown): string | null {
  if (!isRecord(userData)) return null;
  const generation = userData[INDEX_GENERATION_KEY];
  return typeof generation === "string" ? generation : null;
}

function isDefinitiveAlgoliaRejection(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const status = Reflect.get(error, "status");
  return typeof status === "number" && status >= 400 && status < 500;
}

export function withIndexGeneration(
  userData: unknown,
  runId: string,
): { success: true; data: Record<string, unknown> } | { success: false } {
  if (userData !== null && userData !== undefined && !isRecord(userData)) {
    return { success: false };
  }
  return {
    success: true,
    data: {
      ...(isRecord(userData) ? userData : {}),
      [INDEX_GENERATION_KEY]: runId,
    },
  };
}

function rebuildIndexName(runId: string, indexName: string): string {
  return `${indexName}__rebuild_${runId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

export type FullReindexPublishResult =
  | { status: "stopped" }
  | { status: "complete"; searchPublishedAt: Date };

export async function publishFullReindexForRun(params: {
  runId: string;
  runStartedAt: Date;
  database: LibSQLDatabase;
  algolia: ReindexAlgoliaClient;
  indexName: string;
}): Promise<FullReindexPublishResult> {
  const temporaryIndex = rebuildIndexName(params.runId, params.indexName);
  const [run] = await params.database
    .select({
      stage: ingestionRun.stage,
      status: ingestionRun.status,
      activeSlot: ingestionRun.activeSlot,
      moveTaskId: ingestionRun.fullReindexMoveTaskId,
    })
    .from(ingestionRun)
    .where(eq(ingestionRun.id, params.runId))
    .limit(1);
  if (
    !run ||
    run.status !== "running" ||
    run.activeSlot !== 1 ||
    (run.stage !== "full_reindex_publish" &&
      run.stage !== "full_reindex_move_pending")
  ) {
    return { status: "stopped" };
  }
  const liveSettings = await params.algolia.getSettings({
    indexName: params.indexName,
  });
  if (indexGeneration(liveSettings.userData) !== params.runId) {
    let taskId = run.moveTaskId;
    if (taskId === null) {
      if (run.stage === "full_reindex_publish") {
        const enteredCriticalSection = await params.database
          .update(ingestionRun)
          .set({
            stage: "full_reindex_move_pending",
            lastProgressAt: new Date(),
          })
          .where(
            and(
              eq(ingestionRun.id, params.runId),
              eq(ingestionRun.status, "running"),
              eq(ingestionRun.activeSlot, 1),
              eq(ingestionRun.stage, "full_reindex_publish"),
              isNull(ingestionRun.fullReindexMoveTaskId),
            ),
          );
        if (enteredCriticalSection.rowsAffected === 0) {
          return { status: "stopped" };
        }
      }
      let moved: { taskID: number };
      try {
        moved = await params.algolia.operationIndex({
          indexName: temporaryIndex,
          operationIndexParams: {
            operation: "move",
            destination: params.indexName,
          },
        });
      } catch (error) {
        if (isDefinitiveAlgoliaRejection(error)) {
          await params.database
            .update(ingestionRun)
            .set({
              stage: "full_reindex_publish_failed",
              lastProgressAt: new Date(),
            })
            .where(
              and(
                eq(ingestionRun.id, params.runId),
                eq(ingestionRun.status, "running"),
                eq(ingestionRun.activeSlot, 1),
                eq(ingestionRun.stage, "full_reindex_move_pending"),
                isNull(ingestionRun.fullReindexMoveTaskId),
              ),
            );
        }
        throw error;
      }
      const taskPersisted = await params.database
        .update(ingestionRun)
        .set({
          fullReindexMoveTaskId: moved.taskID,
          lastProgressAt: new Date(),
        })
        .where(
          and(
            eq(ingestionRun.id, params.runId),
            eq(ingestionRun.status, "running"),
            eq(ingestionRun.activeSlot, 1),
            eq(ingestionRun.stage, "full_reindex_move_pending"),
            isNull(ingestionRun.fullReindexMoveTaskId),
          ),
        );
      if (taskPersisted.rowsAffected === 0) {
        const [current] = await params.database
          .select({ taskId: ingestionRun.fullReindexMoveTaskId })
          .from(ingestionRun)
          .where(
            and(
              eq(ingestionRun.id, params.runId),
              eq(ingestionRun.status, "running"),
              eq(ingestionRun.activeSlot, 1),
              eq(ingestionRun.stage, "full_reindex_move_pending"),
            ),
          )
          .limit(1);
        if (!current?.taskId) return { status: "stopped" };
        taskId = current.taskId;
      } else {
        taskId = moved.taskID;
      }
    }
    await params.algolia.waitForTask({
      indexName: temporaryIndex,
      taskID: taskId,
    });
    const publishedSettings = await params.algolia.getSettings({
      indexName: params.indexName,
    });
    if (indexGeneration(publishedSettings.userData) !== params.runId) {
      throw new Error(
        `Algolia rebuild ${params.runId} completed without publishing its generation marker.`,
      );
    }
  }

  const publishedAt = new Date();
  const publishRun = params.database
    .update(ingestionRun)
    .set({
      stage: "match_alerts",
      fullReindexRequired: false,
      fullReindexMoveTaskId: null,
      searchPublishedAt: publishedAt,
      lastProgressAt: publishedAt,
    })
    .where(
      and(
        eq(ingestionRun.id, params.runId),
        eq(ingestionRun.status, "running"),
        eq(ingestionRun.activeSlot, 1),
        or(
          eq(ingestionRun.stage, "full_reindex_publish"),
          eq(ingestionRun.stage, "full_reindex_move_pending"),
        ),
      ),
    );
  const clearInheritedRepairs = params.database
    .update(ingestionRun)
    .set({ fullReindexRequired: false })
    .where(
      and(
        eq(ingestionRun.fullReindexRequired, true),
        lte(ingestionRun.startedAt, params.runStartedAt),
        ne(ingestionRun.id, params.runId),
        sql`exists (
          select 1 from ingestion_run as publishing_run
          where publishing_run.id = ${params.runId}
            and publishing_run.status = 'running'
            and publishing_run.active_slot = 1
            and publishing_run.stage = 'match_alerts'
            and publishing_run.full_reindex_required = 0
        )`,
      ),
    );
  // The active-run fence prevents newer reconciliation changes while this
  // generation is built, so every currently unprocessed row is covered.
  const clearPublishedChanges = params.database.delete(vehicleChange).where(
    and(
      isNull(vehicleChange.processedAt),
      sql`exists (
          select 1 from ingestion_run as publishing_run
          where publishing_run.id = ${params.runId}
            and publishing_run.status = 'running'
            and publishing_run.active_slot = 1
            and publishing_run.stage = 'match_alerts'
            and publishing_run.full_reindex_required = 0
        )`,
    ),
  );
  const [published] = await params.database.batch([
    publishRun,
    clearInheritedRepairs,
    clearPublishedChanges,
  ]);
  if (published.rowsAffected === 0) return { status: "stopped" };
  return { status: "complete", searchPublishedAt: publishedAt };
}
