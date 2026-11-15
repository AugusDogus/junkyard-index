import { expect, test } from "bun:test";
import { Effect } from "effect";
import { streamChasencarsInventory } from "../src/server/ingestion/chasencars-connector";
import { chasencarsReader } from "../src/server/ingestion/chasencars-test-fixtures";
import { soakChasencarsInventory } from "./soak-chasencars";

test("Chase N Cars request cap retains the real incomplete catalog frontier", async () => {
  const reader = chasencarsReader();
  const result = await soakChasencarsInventory(
    (startCursor, maxPages) =>
      Effect.runPromise(
        streamChasencarsInventory({
          previousAcceptedCount: null,
          startCursor,
          maxPages,
          readPage: reader.readPage,
          onBatch: () => Effect.die("Partial inventory must not emit"),
          onYards: () => Effect.die("Partial yard must not emit"),
        }),
      ),
    2,
  );
  expect(reader.calls).toHaveLength(2);
  expect(result.status).toBe("paused");
  expect(result.cursor.phase).toBe("catalog");
  expect(result.count).toBe(0);
  expect(result.pagesProcessed).toBe(2);
});

test("Chase N Cars soak rejects an unchanged checkpoint despite a claimed GET", async () => {
  await expect(
    soakChasencarsInventory(async (cursor) => ({
      source: "chasencars",
      status: "paused",
      cursor,
      count: 0,
      pagesProcessed: 1,
      accounting: {
        recordsProcessed: 0,
        recordsExcluded: 0,
        recordsRejected: 0,
        duplicateVehicles: 0,
      },
      observedVins: [],
      errors: [],
      warnings: [],
      rejections: [],
    })),
  ).rejects.toThrow("no valid progress");
});
