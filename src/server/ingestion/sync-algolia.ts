import { Effect } from "effect";
import { algoliaClient, ALGOLIA_INDEX_NAME } from "~/lib/algolia";
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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toAlgoliaObject(record: AlgoliaVehicleRecord): Record<string, unknown> {
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

function waitForTaskEffect(taskID: number): Effect.Effect<void, Error> {
  return Effect.tryPromise({
    try: () =>
      algoliaClient.waitForTask({
        indexName: ALGOLIA_INDEX_NAME,
        taskID,
      }),
    catch: (cause) =>
      cause instanceof Error ? cause : new Error(String(cause)),
  }).pipe(Effect.asVoid);
}

function setIndexSettingsEffect(params: {
  indexName: string;
  indexSettings: Record<string, unknown>;
}): Effect.Effect<void, Error> {
  return Effect.tryPromise({
    try: () =>
      algoliaClient.setSettings({
        indexName: params.indexName,
        indexSettings: params.indexSettings,
      }),
    catch: (cause) =>
      cause instanceof Error ? cause : new Error(String(cause)),
  }).pipe(Effect.asVoid);
}

function saveObjectsBatchEffect(
  objects: ReadonlyArray<Record<string, unknown>>,
): Effect.Effect<unknown, Error> {
  return Effect.tryPromise({
    try: () =>
      algoliaClient.saveObjects({
        indexName: ALGOLIA_INDEX_NAME,
        objects: [...objects],
        waitForTasks: false,
      }),
    catch: (cause) =>
      cause instanceof Error ? cause : new Error(String(cause)),
  });
}

function deleteObjectsBatchEffect(
  objectIDs: string[],
): Effect.Effect<unknown, Error> {
  return Effect.tryPromise({
    try: () =>
      algoliaClient.deleteObjects({
        indexName: ALGOLIA_INDEX_NAME,
        objectIDs,
        waitForTasks: false,
      }),
    catch: (cause) =>
      cause instanceof Error ? cause : new Error(String(cause)),
  });
}

function waitForFinalTask(taskIds: number[]): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    const finalTaskId = taskIds.at(-1);
    if (finalTaskId === undefined) {
      return;
    }

    if (!hasWaitForTask(algoliaClient)) {
      yield* Effect.logWarning(
        "[Algolia] Client does not expose waitForTask(); skipping explicit wait",
      );
      return;
    }

    yield* Effect.logInfo(
      `[Algolia] Waiting for final indexing task ${finalTaskId}...`,
    );
    yield* waitForTaskEffect(finalTaskId);
  });
}

/**
 * Configure Algolia index settings.
 * Usually invoked during deploys or manually, not every ingestion run.
 */
export function configureAlgoliaIndex(): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    yield* Effect.logInfo("[Algolia] Configuring index settings...");
    yield* setIndexSettingsEffect({
      indexName: ALGOLIA_INDEX_NAME,
      indexSettings: {
        searchableAttributes: [
          "make",
          "model",
          "year",
          "unordered(color)",
          "unordered(vin)",
        ],
        attributesForFaceting: [
          "source",
          "searchable(make)",
          "searchable(model)",
          "searchable(color)",
          "searchable(state)",
          "filterOnly(stateAbbr)",
          "searchable(locationName)",
          "year",
        ],
        numericAttributesForFiltering: ["year", "availableDateTs", "firstSeenAt"],
        customRanking: ["desc(availableDateTs)"],
        // Virtual replicas for date/year sorts (share records with primary).
        // Standard replica for distance (needs its own ranking array with geo first).
        replicas: [
          "virtual(vehicles_oldest)",
          "virtual(vehicles_year_desc)",
          "virtual(vehicles_year_asc)",
          "vehicles_distance",
        ],
        // Typo tolerance settings
        typoTolerance: true,
        minWordSizefor1Typo: 3,
        minWordSizefor2Typos: 7,
        // Pagination — large page size so most queries load in 1-2 pages
        hitsPerPage: 1000,
        paginationLimitedTo: 10000,
        // Unretrievable attributes (keep admin key out of search results)
        unretrievableAttributes: ["firstSeenAt"],
      },
    });
    // Configure virtual replica sort orders.
    // relevancyStrictness: 0 disables Algolia's "Relevant Sort" which otherwise
    // limits results to only those it considers "relevantly sorted" (nbSortedHits).
    // Without this, sort replicas return only a handful of results.
    const replicaDefaults = { hitsPerPage: 1000, relevancyStrictness: 0 };
    yield* setIndexSettingsEffect({
      indexName: "vehicles_oldest",
      indexSettings: {
        ...replicaDefaults,
        customRanking: ["asc(availableDateTs)"],
      },
    });
    yield* setIndexSettingsEffect({
      indexName: "vehicles_year_desc",
      indexSettings: { ...replicaDefaults, customRanking: ["desc(year)"] },
    });
    yield* setIndexSettingsEffect({
      indexName: "vehicles_year_asc",
      indexSettings: { ...replicaDefaults, customRanking: ["asc(year)"] },
    });
    // Standard replica for distance sort — geo-dominant ranking (geo first, no customRanking).
    // Standard replicas can override the ranking array, unlike virtual replicas.
    yield* setIndexSettingsEffect({
      indexName: "vehicles_distance",
      indexSettings: {
        ranking: [
          "typo",
          "geo",
          "words",
          "filters",
          "proximity",
          "attribute",
          "exact",
          "custom",
        ],
        customRanking: [],
        hitsPerPage: 1000,
      },
    });
    yield* Effect.logInfo("[Algolia] Index settings configured");
  });
}

/**
 * Batch save objects to Algolia.
 */
export function saveAlgoliaObjects(
  records: AlgoliaVehicleRecord[],
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
export function deleteAlgoliaObjects(vins: string[]): Effect.Effect<number[], Error> {
  return Effect.gen(function* () {
    const taskIds: number[] = [];
    if (vins.length === 0) return taskIds;

    yield* Effect.logInfo(`[Algolia] Deleting ${vins.length} objects...`);

    for (let i = 0; i < vins.length; i += BATCH_SIZE) {
      const batch = vins.slice(i, i + BATCH_SIZE);
      const response = yield* deleteObjectsBatchEffect(batch);
      taskIds.push(...extractTaskIds(response));
    }

    return taskIds;
  });
}

/**
 * Full sync: save upserted records and delete stale ones.
 */
export function syncToAlgolia(
  upserted: AlgoliaVehicleRecord[],
  deletedVins: string[],
  options?: SyncToAlgoliaOptions,
): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    const shouldConfigureIndex = options?.configureIndex === true;
    if (shouldConfigureIndex) {
      if (!configuredInProcess) {
        yield* configureAlgoliaIndex();
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

    const saveTaskIds = yield* saveAlgoliaObjects(upserted);
    const deleteTaskIds = yield* deleteAlgoliaObjects(deletedVins);
    yield* waitForFinalTask([...saveTaskIds, ...deleteTaskIds]);

    yield* Effect.logInfo(
      `[Algolia] Sync complete: ${upserted.length} saved, ${deletedVins.length} deleted`,
    );
  });
}
