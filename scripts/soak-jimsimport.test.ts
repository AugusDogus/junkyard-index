import { expect, test } from "bun:test";
import { Effect } from "effect";
import { streamJimsimportInventory } from "../src/server/ingestion/jimsimport-connector";
import { jimsimportFixture } from "../src/server/ingestion/jimsimport-test-fixtures";
import { soakJimsimportInventory } from "./soak-jimsimport";

test("Jim's Import capped soak preserves owner progress without partial inventory", async () => {
  const result = await soakJimsimportInventory(
    (startCursor, maxPages) =>
      Effect.runPromise(
        streamJimsimportInventory({
          previousUniqueInventory: null,
          startCursor,
          maxPages,
          readPage: (url) =>
            Effect.sync(() => {
              const owner = jimsimportFixture("owner");
              expect(url).toBe(owner.url);
              return owner.body;
            }),
          onBatch: () => Effect.die("Partial inventory must not emit"),
        }),
      ),
    1,
  );
  expect(result.status).toBe("paused");
  expect(result.cursor.phase).toBe("makes");
  expect(result.count).toBe(0);
  expect(result.pagesProcessed).toBe(1);
});

test("Jim's Import soak rejects a claimed GET without checkpoint progress", async () => {
  await expect(
    soakJimsimportInventory(async (cursor) => ({
      source: "jimsimport",
      status: "paused",
      cursor,
      count: 0,
      pagesProcessed: 1,
      accounting: {
        recordsProcessed: 0,
        recordsRejected: 0,
        recordsExcluded: 0,
        duplicateVehicles: 0,
      },
      observedVins: [],
      errors: [],
      warnings: [],
    })),
  ).rejects.toThrow("no valid progress");
});
