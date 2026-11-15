import { expect, test } from "bun:test";
import { Effect } from "effect";
import { streamOemgarageInventory } from "../src/server/ingestion/oemgarage-connector";
import { oemgarageFixture } from "../src/server/ingestion/oemgarage-test-fixtures";
import { soakOemgarageInventory } from "./soak-oemgarage";

test("oeM Garage capped soak retains the real finite donor frontier without emission", async () => {
  const result = await soakOemgarageInventory(
    (startCursor, maxPages) =>
      Effect.runPromise(
        streamOemgarageInventory({
          previousUniqueInventory: null,
          startCursor,
          maxPages,
          readPage: (url) =>
            Effect.sync(() => {
              const capture = oemgarageFixture(
                url.endsWith("/") ? "dov-oemgarage" : "oemgarage-donors",
              );
              expect(url).toBe(capture.url);
              return capture.body;
            }),
          onBatch: () => Effect.die("Partial inventory must not emit"),
          onYards: () => Effect.die("Partial yard must not emit"),
        }),
      ),
    2,
  );
  expect(result.status).toBe("paused");
  expect(result.cursor.phase).toBe("opening");
  expect(result.count).toBe(0);
  expect(result.pagesProcessed).toBe(2);
});

test("oeM Garage soak rejects a claimed GET without checkpoint progress", async () => {
  await expect(
    soakOemgarageInventory(async (cursor) => ({
      source: "oemgarage",
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
