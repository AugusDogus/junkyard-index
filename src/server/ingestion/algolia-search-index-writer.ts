import { Effect } from "effect";
import { getAlgoliaAdminClient } from "~/lib/algolia";
import { getSearchSchemaVersion } from "~/lib/search-index-schema";
import { AlgoliaError, InvalidRequest } from "./algolia-error";
import {
  readIndexGeneration,
  withIndexGeneration,
} from "./durable-algolia-publish";
import type {
  SearchIndexListing,
  SearchIndexWriter,
} from "./search-index-writer";
import {
  deleteAlgoliaObjects,
  saveAlgoliaObjects,
  waitForAlgoliaTask,
} from "./sync-algolia";

const LIST_PAGE_SIZE = 100;

/** One admin call, its failure classified by tag. */
function call<A>(
  operation: string,
  indexName: string | undefined,
  run: () => Promise<A>,
): Effect.Effect<A, AlgoliaError> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) =>
      AlgoliaError.classify(
        indexName === undefined ? { operation } : { operation, indexName },
        cause,
      ),
  });
}

function stampGeneration(
  indexName: string,
  generation: string,
): Effect.Effect<void, AlgoliaError> {
  return Effect.gen(function* () {
    const settings = yield* call("getSettings", indexName, () =>
      getAlgoliaAdminClient().getSettings({ indexName }),
    );
    const userData = withIndexGeneration(settings.userData, generation);
    if (!userData.success) {
      return yield* Effect.fail(
        new InvalidRequest({
          operation: "setSettings",
          indexName,
          status: null,
          detail: "the index userData is not an object",
          message: `Cannot stamp search index generation ${generation} on ${indexName}: its settings userData is not an object. Nothing was moved; fix the userData in the Algolia dashboard, then request a rebuild.`,
          cause: settings.userData,
        }),
      );
    }
    const updated = yield* call("setSettings", indexName, () =>
      getAlgoliaAdminClient().setSettings({
        indexName,
        indexSettings: { userData: userData.data },
      }),
    );
    yield* waitForAlgoliaTask(updated.taskID, indexName);
  });
}

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
    call("getSettings", indexName, () =>
      getAlgoliaAdminClient().getSettings({ indexName }),
    ).pipe(
      Effect.map((settings) => ({
        generation: readIndexGeneration(settings.userData),
        schemaVersion: getSearchSchemaVersion(settings.userData),
      })),
    ),

  listIndices: () =>
    Effect.gen(function* () {
      const indices: SearchIndexListing[] = [];
      // Collect every page before acting, so deletions cannot shift pages.
      for (let page = 0; ; page += 1) {
        const result = yield* call("listIndices", undefined, () =>
          getAlgoliaAdminClient().listIndices({
            page,
            hitsPerPage: LIST_PAGE_SIZE,
          }),
        );
        for (const index of result.items) {
          indices.push({
            name: index.name,
            entries: index.entries,
            primary: index.primary ?? null,
            replicas: index.replicas ?? [],
            virtual: index.virtual === true,
          });
        }
        const lastPage =
          result.nbPages === undefined
            ? result.items.length < LIST_PAGE_SIZE
            : page + 1 >= result.nbPages;
        if (lastPage) return indices;
      }
    }),

  prepareIndex: ({ from, to, generation }) =>
    Effect.gen(function* () {
      // Copying a missing index does not fail: Algolia creates an empty one
      // with default settings. Check the source exists first.
      const exists = yield* call("getSettings", from, () =>
        getAlgoliaAdminClient().getSettings({ indexName: from }),
      ).pipe(
        Effect.as(true),
        Effect.catchTag("NotFound", () => Effect.succeed(false)),
      );
      if (!exists) return "missing_source";
      const copied = yield* call("operationIndex copy", from, () =>
        getAlgoliaAdminClient().operationIndex({
          indexName: from,
          operationIndexParams: {
            operation: "copy",
            destination: to,
            scope: ["settings", "synonyms", "rules"],
          },
        }),
      ).pipe(Effect.map((response) => response.taskID));
      yield* waitForAlgoliaTask(copied, to);
      // A leftover copy of this generation may hold records from an earlier
      // attempt; loading starts from an empty index.
      const cleared = yield* call("clearObjects", to, () =>
        getAlgoliaAdminClient().clearObjects({ indexName: to }),
      );
      yield* waitForAlgoliaTask(cleared.taskID, to);
      yield* stampGeneration(to, generation);
      return "copied";
    }),

  moveIndex: (from, to) =>
    call("operationIndex move", from, () =>
      getAlgoliaAdminClient().operationIndex({
        indexName: from,
        operationIndexParams: { operation: "move", destination: to },
      }),
    ).pipe(Effect.map((response) => response.taskID)),

  deleteIndex: (indexName) =>
    call("deleteIndex", indexName, () =>
      getAlgoliaAdminClient().deleteIndex({ indexName }),
    ).pipe(
      Effect.flatMap((deleted) =>
        waitForAlgoliaTask(deleted.taskID, indexName),
      ),
      Effect.catchTag("NotFound", () => Effect.void),
    ),
};
