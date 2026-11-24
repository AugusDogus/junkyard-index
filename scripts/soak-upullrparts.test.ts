import { expect, test } from "bun:test";
import { soakUpullRPartsInventory } from "./soak-upullrparts";
import { UpullRPartsCursor } from "../src/server/ingestion/upullrparts-cursor";

test("U Pull R Parts soak stops on a blocked IP instead of opening another session", async () => {
  let calls = 0;
  const blocked = soakUpullRPartsInventory(async (cursor) => {
    calls++;
    return {
      source: "upullrparts",
      status: "paused",
      cursor: { ...cursor, blockedSince: 1, retryAt: 2 },
      count: 0,
      errors: [],
      warnings: ["getVehicles returned no Ford vehicles."],
      pagesProcessed: 0,
    };
  }, UpullRPartsCursor.initial);
  await expect(blocked).rejects.toThrow(
    "getVehicles returned no Ford vehicles.",
  );
  expect(calls).toBe(1);
});
