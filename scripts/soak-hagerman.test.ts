import { expect, test } from "bun:test";
import { Effect } from "effect";
import { streamHagermanInventoryWithRequestGate } from "../src/server/ingestion/hagerman-connector";
import { hagermanFixture } from "../src/server/ingestion/hagerman-test-fixtures";
import { soakHagermanInventory } from "./soak-hagerman";

test("Hagerman capped soak retains the native opening without emitting partial inventory", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = Object.assign(
    async () => {
      const body = hagermanFixture(requests++ === 0 ? "contact" : "catalog");
      return new Response(body, { headers: { "content-type": "text/html" } });
    },
    { preconnect: original.preconnect },
  );
  try {
    const result = await soakHagermanInventory(
      (startCursor, maxPages) =>
        Effect.runPromise(
          streamHagermanInventoryWithRequestGate(
            {
              startCursor,
              maxPages,
              onBatch: () => Effect.die("Partial inventory must not emit"),
              onYards: () => Effect.die("Partial yard must not emit"),
            },
            (request) => request,
          ),
        ),
      2,
    );
    expect(requests).toBe(2);
    expect(result.status).toBe("paused");
    expect(result.cursor.phase).toBe("details");
    expect(result.count).toBe(0);
    expect(result.pagesProcessed).toBe(2);
  } finally {
    globalThis.fetch = original;
  }
});

test("Hagerman soak rejects a claimed GET without checkpoint progress", async () => {
  await expect(
    soakHagermanInventory(async (cursor) => ({
      source: "hagerman",
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
