import { expect, test } from "bun:test";
import { soakUpullRPartsInventory } from "./soak-upullrparts";
import type { UpullRPartsStreamResult } from "../src/server/ingestion/upullrparts-connector";
import {
  UpullRPartsCursor,
  type UpullRPartsCursor as Cursor,
} from "../src/server/ingestion/upullrparts-cursor";

const crawl = {
  source: "upullrparts",
  phase: "crawl",
  location: "1",
  today: "2026-11-24",
  end: "2026-11-24",
  statePath: "memory:directory",
  storesSeen: [],
} as const satisfies Cursor;

const chunk = (
  cursor: Cursor,
  fields: Partial<UpullRPartsStreamResult> = {},
): UpullRPartsStreamResult => ({
  source: "upullrparts",
  status: cursor.phase === "complete" ? "complete" : "paused",
  cursor,
  count: 0,
  errors: [],
  warnings: [],
  pagesProcessed: 0,
  ...fields,
});

test("U Pull R Parts soak stops on a blocked IP instead of opening another session", async () => {
  let calls = 0;
  const blocked = soakUpullRPartsInventory(
    async () => {
      calls++;
      return chunk(
        { ...crawl, blockedSince: 1, retryAt: 2 },
        { warnings: ["getVehicles returned no Ford vehicles."] },
      );
    },
    crawl,
    60,
    new Map([["memory:directory", {}]]),
  );
  await expect(blocked).rejects.toThrow(
    "getVehicles returned no Ford vehicles.",
  );
  expect(calls).toBe(1);
});

test("U Pull R Parts soak keeps the directory chunk's state and names it in the next cursor, as the repository does", async () => {
  const directory = { version: 1, makes: ["FORD"], models: {} };
  const seen: { cursor: Cursor; state: unknown }[] = [];
  const result = await soakUpullRPartsInventory(async (cursor, loadState) => {
    if (cursor.phase === "directory")
      return chunk(
        { ...crawl, statePath: null },
        { checkpointState: directory },
      );
    if (cursor.phase === "crawl" && cursor.statePath !== null)
      seen.push({ cursor, state: await loadState(cursor.statePath) });
    return chunk({ source: "upullrparts", phase: "complete", storesSeen: [] });
  }, UpullRPartsCursor.initial);
  expect(result.status).toBe("complete");
  expect(seen).toEqual([
    {
      cursor: { ...crawl, statePath: "memory:chunk-1" },
      state: directory,
    },
  ]);
});
