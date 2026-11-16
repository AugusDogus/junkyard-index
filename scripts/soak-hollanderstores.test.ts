import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Effect } from "effect";
import { streamHollanderstoresInventory } from "../src/server/ingestion/hollanderstores-connector";
import { soakHollanderstoresInventory } from "./soak-hollanderstores";

test("Hollander Stores capped soak preserves its checkpoint without partial inventory", async () => {
  const result = await soakHollanderstoresInventory(
    (startCursor, maxPages) =>
      Effect.runPromise(
        streamHollanderstoresInventory({
          startCursor,
          maxPages,
          decodeBatch: () => Effect.die("No decode before a complete census"),
          onBatch: () => Effect.die("Partial inventory must not emit"),
          readPage: (yard) =>
            Effect.sync(() =>
              gunzipSync(
                readFileSync(
                  `${import.meta.dir}/../src/server/ingestion/hollanderstores-test-fixtures/${yard.code}.html.gz`,
                ),
              ).toString("utf8"),
            ),
        }),
      ),
    1,
  );
  expect(result.status).toBe("paused");
  expect(result.pagesProcessed).toBe(1);
  expect(result.count).toBe(0);
  expect(result.cursor.pages).toHaveLength(1);
});
test("Hollander Stores soak rejects false request progress", async () => {
  await expect(
    soakHollanderstoresInventory(async (cursor) => ({
      source: "hollanderstores",
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

test("Hollander Stores soak stops on a failed census without another request", async () => {
  let calls = 0;
  const result = await soakHollanderstoresInventory(async (cursor) => {
    calls++;
    return {
      source: "hollanderstores",
      status: "failed",
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
      errors: ["Closing census exceeds turnover limit"],
      warnings: [],
    };
  });
  expect(result.status).toBe("failed");
  expect(result.errors).toEqual(["Closing census exceeds turnover limit"]);
  expect(calls).toBe(1);
});
