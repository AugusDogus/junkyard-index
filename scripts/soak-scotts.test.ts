import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { soakScottsInventory } from "./soak-scotts";
import { ScottsCursor } from "../src/server/ingestion/scotts-cursor";
import { streamScottsInventoryWithRequestGate } from "../src/server/ingestion/scotts-connector";
import { scottsFixture } from "../src/server/ingestion/scotts-test-fixtures";
import {
  SCOTTS_MAKES,
  SCOTTS_ROOT,
} from "../src/server/ingestion/scotts-yard-metadata";

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});

test("Scott's read-only request cap retains the real incomplete make frontier", async () => {
  const requested: string[] = [];
  const pages = new Map([
    [SCOTTS_ROOT, scottsFixture("root")],
    [SCOTTS_MAKES, scottsFixture("makes")],
  ]);
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      requested.push(url);
      const body = pages.get(url);
      if (!body) throw new Error("Unexpected source request: " + url);
      return new Response(body, { headers: { "content-type": "text/html" } });
    },
    { preconnect: original.preconnect },
  );
  const result = await soakScottsInventory(
    (startCursor, maxPages) =>
      Effect.runPromise(
        streamScottsInventoryWithRequestGate(
          {
            startCursor,
            maxPages,
            onBatch: () => Effect.die("Incomplete inventory must not emit"),
          },
          (request) => request,
        ),
      ),
    2,
  );
  expect(requested).toEqual([SCOTTS_ROOT, SCOTTS_MAKES]);
  expect(result.status).toBe("paused");
  expect(result.cursor.phase).toBe("makes");
  expect(result.pagesProcessed).toBe(2);
  expect(result.count).toBe(0);
});

test.each(["paused", "complete"] as const)(
  "Scott's soak refuses %s without cursor progress",
  async (status) => {
    await expect(
      soakScottsInventory(async () => ({
        source: "scotts",
        status,
        cursor: ScottsCursor.initial,
        count: 0,
        pagesProcessed: 0,
        accounting: {
          recordsProcessed: 0,
          recordsExcluded: 0,
          recordsRejected: 0,
          duplicateVehicles: 0,
        },
        errors: [],
        warnings: [],
        observedVins: [],
      })),
    ).rejects.toThrow("no valid progress");
  },
);
