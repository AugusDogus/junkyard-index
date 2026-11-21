import { Effect } from "effect";
import { getAlgoliaAdminClient } from "~/lib/algolia";
import { getSearchSchemaVersion } from "~/lib/search-index-schema";
import { AlgoliaError } from "./algolia-error";
import { readIndexGeneration } from "./durable-algolia-publish";
import type { SearchIndexWriter } from "./search-index-writer";
import {
  deleteAlgoliaObjects,
  saveAlgoliaObjects,
  waitForAlgoliaTask,
} from "./sync-algolia";

/** The search projector's writer over the Algolia admin client. */
export const AlgoliaSearchIndexWriter: SearchIndexWriter = {
  saveObjects: (indexName, records) =>
    saveAlgoliaObjects([...records], indexName).pipe(
      Effect.map((taskIds) => taskIds.at(-1) ?? null),
    ),

  deleteObjects: (indexName, objectIDs) =>
    deleteAlgoliaObjects([...objectIDs], indexName).pipe(
      Effect.map((taskIds) => taskIds.at(-1) ?? null),
    ),

  waitForTask: (indexName, taskId) => waitForAlgoliaTask(taskId, indexName),

  metadata: (indexName) =>
    Effect.tryPromise({
      try: () => getAlgoliaAdminClient().getSettings({ indexName }),
      catch: (cause) =>
        AlgoliaError.classify({ operation: "getSettings", indexName }, cause),
    }).pipe(
      Effect.map((settings) => ({
        generation: readIndexGeneration(settings.userData),
        schemaVersion: getSearchSchemaVersion(settings.userData),
      })),
    ),
};
