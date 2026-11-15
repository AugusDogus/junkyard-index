import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Effect } from "effect";
import { z } from "zod";
import { streamDutchersInventoryWithRequestGate } from "../src/server/ingestion/dutchers-connector";
import { DutchersCursor } from "../src/server/ingestion/dutchers-cursor";
import {
  DUTCHERS_SCOPE,
  DUTCHERS_STORE,
} from "../src/server/ingestion/dutchers-yard-metadata";
import { soakDutchersInventory } from "./soak-dutchers";

test("Dutcher request cap preserves its incomplete native roster without emission", async () => {
  const fixture = z
    .array(z.string())
    .parse(
      JSON.parse(
        gunzipSync(
          readFileSync(
            new URL(
              "../src/server/ingestion/dutchers-test-fixtures/native.json.gz",
              import.meta.url,
            ),
          ),
        ).toString(),
      ),
    );
  const calls: string[] = [];
  const result = await soakDutchersInventory(
    (startCursor, maxPages) =>
      Effect.runPromise(
        streamDutchersInventoryWithRequestGate(
          {
            startCursor,
            maxPages,
            readPage: (url) => {
              const body = fixture[calls.length];
              calls.push(url);
              if (body === undefined)
                return Effect.die("Unexpected native control: " + url);
              return Effect.succeed(body);
            },
            onBatch: () => Effect.die("Partial inventory must not emit"),
            onYards: () => Effect.die("Partial yard must not emit"),
          },
          (request) => request,
        ),
      ),
    2,
  );
  expect(calls).toEqual([DUTCHERS_SCOPE, DUTCHERS_STORE]);
  expect(result.status).toBe("paused");
  expect(result.cursor.phase).toBe("opening");
  expect(result.count).toBe(0);
  expect(result.pagesProcessed).toBe(2);
});

test.each([0, 8])(
  "Dutcher soak refuses an unchanged checkpoint reporting %i GETs",
  async (pagesProcessed) => {
    await expect(
      soakDutchersInventory(async (cursor) => ({
        source: "dutchers",
        status: "paused",
        cursor,
        count: 0,
        pagesProcessed,
        accounting: {
          recordsProcessed: 0,
          recordsExcluded: 0,
          recordsRejected: 0,
          duplicateVehicles: 0,
        },
        observedVins: [],
        errors: [],
        warnings: [],
      })),
    ).rejects.toThrow("no valid progress");
    expect(DutchersCursor.initial().phase).toBe("scope-opening");
  },
);
