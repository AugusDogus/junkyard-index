import { expect, test } from "bun:test";
import { WeberbrothersCursor } from "../src/server/ingestion/weberbrothers-cursor";
import { parseWeberbrothersCatalog } from "../src/server/ingestion/weberbrothers-parser";
import {
  weberbrothersFixtureListing,
  weberbrothersFixtureRoot,
} from "../src/server/ingestion/weberbrothers-test-fixtures";
import { soakWeberbrothersInventory } from "./soak-weberbrothers";

test("Weber Brothers capped soak retains its complete opening and no partial output", async () => {
  const cursor = WeberbrothersCursor.checkpoint({
    ...WeberbrothersCursor.initial,
    phase: "details",
    pages: [
      parseWeberbrothersCatalog(
        weberbrothersFixtureListing(),
        weberbrothersFixtureRoot,
      ),
    ],
  });
  const result = await soakWeberbrothersInventory(
    async () => ({
      source: "weberbrothers",
      status: "paused",
      cursor,
      count: 0,
      pagesProcessed: 1,
      errors: [],
      warnings: [],
      observedVins: [],
      accounting: {
        recordsProcessed: 0,
        recordsRejected: 0,
        recordsExcluded: 0,
        duplicateVehicles: 0,
      },
    }),
    1,
  );
  expect(result.status).toBe("paused");
  expect(result.cursor.phase).toBe("details");
  expect(result.pagesProcessed).toBe(1);
});

test("Weber Brothers soak rejects a falsely claimed request without checkpoint progress", async () => {
  await expect(
    soakWeberbrothersInventory(async (cursor) => ({
      source: "weberbrothers",
      status: "paused",
      cursor,
      count: 0,
      pagesProcessed: 1,
      errors: [],
      warnings: [],
      observedVins: [],
      accounting: {
        recordsProcessed: 0,
        recordsRejected: 0,
        recordsExcluded: 0,
        duplicateVehicles: 0,
      },
    })),
  ).rejects.toThrow("no valid progress");
});
