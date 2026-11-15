import { expect, test } from "bun:test";
import { Effect } from "effect";
import { streamCstruckInventory } from "../src/server/ingestion/cstruck-connector";
import { cstruckFixture } from "../src/server/ingestion/cstruck-test-fixtures";
import { soakCstruckInventory } from "./soak-cstruck";

test("C&S Truck Sales capped soak preserves owner progress without partial inventory", async () => {
  const result = await soakCstruckInventory(
    (startCursor, maxPages) =>
      Effect.runPromise(
        streamCstruckInventory({
          previousAcceptedCount: null,
          startCursor,
          maxPages,
          readPage: (url) =>
            Effect.sync(() => {
              expect(url).toBe(
                "https://www.heavytruckparts.net/search.php?fltpc=7131988&store=1",
              );
              return cstruckFixture("store-opening");
            }),
          onBatch: () => Effect.die("Partial inventory must not emit"),
        }),
      ),
    1,
  );
  expect(result.status).toBe("paused");
  expect(result.cursor.phase).toBe("opening");
  expect(result.count).toBe(0);
  expect(result.pagesProcessed).toBe(1);
});

test("C&S Truck Sales soak rejects a claimed GET without checkpoint progress", async () => {
  await expect(
    soakCstruckInventory(async (cursor) => ({
      source: "cstruck",
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
