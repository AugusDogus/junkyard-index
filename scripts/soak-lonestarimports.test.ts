import { expect, test } from "bun:test";
import { Effect } from "effect";
import { streamLonestarimportsInventory } from "../src/server/ingestion/lonestarimports-connector";
import { lonestarimportsNative } from "../src/server/ingestion/lonestarimports-test-fixtures";
import { soakLonestarimportsInventory } from "./soak-lonestarimports";

test("Lonestar Imports capped soak preserves owner progress without partial inventory", async () => {
  const result = await soakLonestarimportsInventory(
    (startCursor, maxPages) =>
      Effect.runPromise(
        streamLonestarimportsInventory({
          previousAcceptedCount: null,
          startCursor,
          maxPages,
          readPage: (url) =>
            Effect.sync(() => {
              expect(url).toBe("https://www.lonestarimport.com/");
              return lonestarimportsNative.openingDocuments[0] ?? "";
            }),
          onBatch: () => Effect.die("Partial inventory must not emit"),
        }),
      ),
    1,
  );
  expect(result.status).toBe("paused");
  expect(result.cursor.phase).toBe("opening-documents");
  expect(result.count).toBe(0);
  expect(result.pagesProcessed).toBe(1);
});

test("Lonestar Imports soak rejects a claimed GET without checkpoint progress", async () => {
  await expect(
    soakLonestarimportsInventory(async (cursor) => ({
      source: "lonestarimports",
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
      rejections: [],
    })),
  ).rejects.toThrow("no valid progress");
});
