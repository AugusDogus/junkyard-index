import { expect, test } from "bun:test";
import { Effect } from "effect";
import { HawaiipartsCursor } from "../src/server/ingestion/hawaiiparts-cursor";
import { streamHawaiipartsInventory } from "../src/server/ingestion/hawaiiparts-connector";
import { shopifyYardFixture } from "../src/server/ingestion/shopify-yard-test-fixtures";
import { soakShopifyYard } from "./soak-shopify-yard";
const chunk = (startCursor: HawaiipartsCursor, maxPages: number) =>
  Effect.runPromise(
    streamHawaiipartsInventory({
      startCursor,
      maxPages,
      previousUniqueInventory: null,
      readPage: (url) =>
        Effect.succeed(
          shopifyYardFixture(
            url.endsWith("/") ? "hawaiiparts-home" : "hawaiiparts-yard-html",
          ),
        ),
      onBatch: () => Effect.void,
    }),
  );
test("Shopify soak completes offline, or returns an uncounted validated partial cursor at its cap", async () => {
  const done = await soakShopifyYard(HawaiipartsCursor.initial(), chunk);
  expect(done.status).toBe("complete");
  expect(done.count).toBe(44);
  expect(done.pagesProcessed).toBe(4);
  const paused = await soakShopifyYard(HawaiipartsCursor.initial(), chunk, 2);
  expect(paused.status).toBe("paused");
  expect(paused.count).toBe(0);
  expect(paused.cursor.phase).toBe("closing");
});
test("Shopify soak rejects invalid budgets and no-progress chunks", async () => {
  await expect(
    soakShopifyYard(HawaiipartsCursor.initial(), chunk, 0),
  ).rejects.toThrow("positive GET budget");
  await expect(
    soakShopifyYard(HawaiipartsCursor.initial(), async (cursor) => ({
      source: "hawaiiparts",
      cursor,
      status: "paused",
      count: 0,
      pagesProcessed: 1,
      errors: [],
    })),
  ).rejects.toThrow("validated progress");
});
