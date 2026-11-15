import { expect, test } from "bun:test";
import { Effect } from "effect";
import { streamKandrInventory } from "../src/server/ingestion/kandr-connector";
import { KANDR_CONTRACT } from "../src/server/ingestion/kandr-configuration";
import { kandrFixture } from "../src/server/ingestion/kandr-test-fixtures";
import { soakKandrInventory } from "./soak-kandr";

test("K&R capped soak retains its native controls without partial inventory", async () => {
  const result = await soakKandrInventory(
    (startCursor, maxPages) =>
      Effect.runPromise(
        streamKandrInventory({
          contract: KANDR_CONTRACT,
          previousUniqueInventory: null,
          startCursor,
          maxPages,
          readPage: (url) =>
            Effect.sync(() => {
              expect(url).toBe(kandrFixture.controls.url);
              return kandrFixture.controls.html;
            }),
          onBatch: () => Effect.die("Partial inventory must not emit"),
        }),
      ),
    1,
  );
  expect(result.status).toBe("paused");
  expect(result.cursor.phase).toBe("collecting");
  expect(result.count).toBe(0);
  expect(result.pagesProcessed).toBe(1);
});

test("K&R soak rejects a claimed GET without checkpoint progress", async () => {
  await expect(
    soakKandrInventory(async (cursor) => ({
      source: "kandr",
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
  ).rejects.toThrow("no progress");
});
