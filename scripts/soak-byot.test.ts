import { expect, test } from "bun:test";
import { soakByotInventory } from "./soak-byot";
import { ByotCursor } from "../src/server/ingestion/byot-cursor";
import { byotValue } from "../src/server/ingestion/byot-test-fixtures";

test("BYOT count-only soak serializes paused cursors and respects its total request budget", async () => {
  const result = await soakByotInventory(async (_cursor, maxPages) => {
    expect(maxPages).toBe(1);
    return {
      source: "byot",
      status: "paused",
      cursor: byotValue(ByotCursor.begin(null, Date.UTC(2026, 10, 15))),
      count: 0,
      pagesProcessed: 1,
      errors: [],
    };
  }, 1);
  expect(result.status).toBe("paused");
  expect(result.pagesProcessed).toBe(1);
});
test("BYOT soak rejects no progress and invalid budgets without making requests", async () => {
  let calls = 0;
  const chunk = async (cursor: ByotCursor) => {
    calls++;
    return {
      source: "byot" as const,
      status: "paused" as const,
      cursor,
      count: 0,
      pagesProcessed: 0,
      errors: [],
    };
  };
  await expect(soakByotInventory(chunk, 0)).rejects.toThrow("positive integer");
  expect(calls).toBe(0);
  await expect(soakByotInventory(chunk, 1)).rejects.toThrow("no progress");
});
