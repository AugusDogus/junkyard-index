import { Effect } from "effect";
import type { IndexSettings } from "algoliasearch";
import { algoliaAdminClient, ALGOLIA_INDEX_NAME } from "~/lib/algolia";
import { buildAlgoliaSettingsPlan } from "./algolia-settings-plan";
import type { AlgoliaVehicleRecord } from "./types";

const BATCH_SIZE = 1000;
let configuredInProcess = false;
interface WaitForTaskClient {
  waitForTask?: (params: {
    indexName: string;
    taskID: number;
  }) => Promise<unknown>;
}

interface SyncToAlgoliaOptions {
  configureIndex?: boolean;
  indexName?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toAlgoliaObject(
  record: AlgoliaVehicleRecord,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record));
}

function extractTaskIds(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractTaskIds(entry));
  }

  if (!isRecord(value)) {
    return [];
  }

  const taskIds: number[] = [];

  const taskIDValue =
    typeof value.taskID === "number"
      ? value.taskID
      : typeof value.taskId === "number"
        ? value.taskId
        : null;
  if (taskIDValue !== null) {
    taskIds.push(taskIDValue);
  }

  const nestedKeys = ["results", "responses", "items", "tasks"];
  for (const key of nestedKeys) {
    const nested = value[key];
    if (Array.isArray(nested)) {
      taskIds.push(...extractTaskIds(nested));
    }
  }

  return taskIds;
}

function hasWaitForTask(value: unknown): value is WaitForTaskClient {
  return isRecord(value) && typeof value.waitForTask === "function";
}

function waitForTaskEffect(
  taskID: number,
  indexName: string,
): Effect.Effect<void, Error> {
  return Effect.tryPromise({
    try: () =>
      algoliaAdminClient.waitForTask({
        indexName,
        taskID,
      }),
    catch: (cause) =>
      cause instanceof Error ? cause : new Error(String(cause)),
  }).pipe(Effect.asVoid);
}

function setIndexSettingsEffect(params: {
  indexName: string;
  indexSettings: IndexSettings;
  forwardToReplicas?: boolean;
}): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        algoliaAdminClient.setSettings({
          indexName: params.indexName,
          indexSettings: params.indexSettings,
          forwardToReplicas: params.forwardToReplicas,
        }),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    });
    const taskID = extractTaskIds(response).at(-1);
    if (taskID !== undefined) {
      yield* Effect.tryPromise({
        try: () =>
          algoliaAdminClient.waitForTask({
            indexName: params.indexName,
            taskID,
          }),
        catch: (cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
      });
    }
  }).pipe(Effect.asVoid);
}

function saveObjectsBatchEffect(
  objects: ReadonlyArray<Record<string, unknown>>,
  indexName: string,
): Effect.Effect<unknown, Error> {
  return Effect.tryPromise({
    try: () =>
      algoliaAdminClient.saveObjects({
        indexName,
        objects: [...objects],
        waitForTasks: false,
      }),
    catch: (cause) =>
      cause instanceof Error ? cause : new Error(String(cause)),
  });
}

function deleteObjectsBatchEffect(
  objectIDs: string[],
  indexName: string,
): Effect.Effect<unknown, Error> {
  return Effect.tryPromise({
    try: () =>
      algoliaAdminClient.deleteObjects({
        indexName,
        objectIDs,
        waitForTasks: false,
      }),
    catch: (cause) =>
      cause instanceof Error ? cause : new Error(String(cause)),
  });
}

function waitForFinalTask(
  taskIds: number[],
  indexName: string,
): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    const finalTaskId = taskIds.at(-1);
    if (finalTaskId === undefined) {
      return;
    }

    if (!hasWaitForTask(algoliaAdminClient)) {
      yield* Effect.logWarning(
        "[Algolia] Client does not expose waitForTask(); skipping explicit wait",
      );
      return;
    }

    yield* Effect.logInfo(
      `[Algolia] Waiting for final indexing task ${finalTaskId}...`,
    );
    yield* waitForTaskEffect(finalTaskId, indexName);
  });
}

/**
 * Configure Algolia index settings.
 * Usually invoked during deploys or manually, not every ingestion run.
 */
export function configureAlgoliaIndexEffect(): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    yield* Effect.logInfo("[Algolia] Configuring index settings...");
    for (const operation of buildAlgoliaSettingsPlan()) {
      yield* setIndexSettingsEffect(operation);
    }
    yield* Effect.logInfo("[Algolia] Index settings configured");
  });
}

export async function configureAlgoliaIndex(): Promise<void> {
  return Effect.runPromise(configureAlgoliaIndexEffect());
}

/**
 * Batch save objects to Algolia.
 */
export function saveAlgoliaObjects(
  records: AlgoliaVehicleRecord[],
  indexName = ALGOLIA_INDEX_NAME,
): Effect.Effect<number[], Error> {
  return Effect.gen(function* () {
    const taskIds: number[] = [];
    if (records.length === 0) return taskIds;

    yield* Effect.logInfo(
      `[Algolia] Saving ${records.length} objects in batches of ${BATCH_SIZE}...`,
    );

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const response = yield* saveObjectsBatchEffect(
        batch.map(toAlgoliaObject),
        indexName,
      );
      taskIds.push(...extractTaskIds(response));
      yield* Effect.logInfo(
        `[Algolia] Saved batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(records.length / BATCH_SIZE)}`,
      );
    }

    return taskIds;
  });
}

/**
 * Batch delete objects from Algolia by objectID (VIN).
 */
export function deleteAlgoliaObjects(
  vins: string[],
  indexName = ALGOLIA_INDEX_NAME,
): Effect.Effect<number[], Error> {
  return Effect.gen(function* () {
    const taskIds: number[] = [];
    if (vins.length === 0) return taskIds;

    yield* Effect.logInfo(`[Algolia] Deleting ${vins.length} objects...`);

    for (let i = 0; i < vins.length; i += BATCH_SIZE) {
      const batch = vins.slice(i, i + BATCH_SIZE);
      const response = yield* deleteObjectsBatchEffect(batch, indexName);
      taskIds.push(...extractTaskIds(response));
    }

    return taskIds;
  });
}

/**
 * Full sync: save upserted records and delete stale ones.
 */
export function syncToAlgoliaEffect(
  upserted: AlgoliaVehicleRecord[],
  deletedVins: string[],
  options?: SyncToAlgoliaOptions,
): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    const shouldConfigureIndex = options?.configureIndex === true;
    const indexName = options?.indexName ?? ALGOLIA_INDEX_NAME;
    if (shouldConfigureIndex) {
      if (!configuredInProcess) {
        yield* configureAlgoliaIndexEffect();
        configuredInProcess = true;
      } else {
        yield* Effect.logInfo(
          "[Algolia] Skipping index settings (already configured in-process)",
        );
      }
    } else {
      yield* Effect.logInfo(
        "[Algolia] Skipping index settings during ingestion (set ALGOLIA_CONFIGURE_ON_INGEST=1 to enable)",
      );
    }

    const saveTaskIds = yield* saveAlgoliaObjects(upserted, indexName);
    const deleteTaskIds = yield* deleteAlgoliaObjects(deletedVins, indexName);
    yield* waitForFinalTask([...saveTaskIds, ...deleteTaskIds], indexName);

    yield* Effect.logInfo(
      `[Algolia] Sync complete: ${upserted.length} saved, ${deletedVins.length} deleted`,
    );
  });
}

export async function syncToAlgolia(
  upserted: AlgoliaVehicleRecord[],
  deletedVins: string[],
  options?: SyncToAlgoliaOptions,
): Promise<void> {
  return Effect.runPromise(syncToAlgoliaEffect(upserted, deletedVins, options));
}
