import { VanderHaagsCensus } from "../src/server/ingestion/vanderhaags-census";
import { expect, test } from "bun:test";
import { soakVanderHaagsInventory } from "./soak-vanderhaags";
import type { VanderHaagsStreamResult } from "../src/server/ingestion/vanderhaags-connector";

test("a capped soak stops at the requested detail budget and retains resumable accounting", async () => {
  const budgets: number[] = [];
  const result = await soakVanderHaagsInventory(async (cursor, maxPages) => {
    budgets.push(maxPages);
    const offset = (cursor.phase === "details" ? cursor.offset : 0) + maxPages;
    return {
      source: "vanderhaags",
      status: "paused",
      cursor: {
        source: "vanderhaags",
        phase: "details",
        catalogHash: "a".repeat(64),
        offset,
        rejected: offset,
        seenVins: [],
        census: VanderHaagsCensus.checkpoint({
          contract: "detail-census-v2",
          scope: "a".repeat(64),
          startedAt: 0,
          reverification: { day: 0, paths: [] },
          entries: [],
        }),
      },
      count: 0,
      pagesProcessed: maxPages,
      errors: [],
      warnings: ["Quarantined donor description"],
      observedVins: [],
      accounting: {
        recordsProcessed: maxPages,
        recordsExcluded: 0,
        recordsRejected: maxPages,
        duplicateVehicles: 0,
      },
    } satisfies VanderHaagsStreamResult;
  }, 17);
  expect(budgets).toEqual([12, 5]);
  expect(result.status).toBe("paused");
  expect(result.cursor).toMatchObject({ phase: "details", offset: 17 });
  expect(result.pagesProcessed).toBe(17);
  expect(result.accounting?.recordsRejected).toBe(17);
  expect(result.warnings).toHaveLength(2);
});

test("an unchanged checkpoint stops the soak instead of looping", async () => {
  await expect(
    soakVanderHaagsInventory(async (cursor) => ({
      source: "vanderhaags",
      status: "paused",
      cursor,
      count: 0,
      pagesProcessed: 0,
      errors: [],
    })),
  ).rejects.toThrow("made no progress");
});
