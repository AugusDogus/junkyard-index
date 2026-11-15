import { expect, test } from "bun:test";
import { Effect } from "effect";
import { soakOemInventory } from "./soak-oem";
import { streamOemInventory } from "../src/server/ingestion/oem-connector";
import { OemCursor } from "../src/server/ingestion/oem-cursor";
import {
  oemArrivalFixture,
  oemMakeFixture,
} from "../src/server/ingestion/oem-test-fixtures";
import { OEM_ARRIVALS, OEM_MAKES } from "../src/server/ingestion/oem-html";
import { OEM_LOCATION } from "../src/server/ingestion/oem-yard-metadata";

test("OEM read-only cap retains the native make frontier without emission", async () => {
  const requested: string[] = [];
  const pages = new Map([
    [OEM_ARRIVALS, oemArrivalFixture],
    [OEM_MAKES, oemMakeFixture],
  ]);
  const result = await soakOemInventory(
    (startCursor, maxPages) =>
      Effect.runPromise(
        streamOemInventory({
          startCursor,
          maxPages,
          location: OEM_LOCATION,
          minimumUniqueInventory: 1_800,
          previousUniqueInventory: null,
          readPage: (url) =>
            Effect.sync(() => {
              requested.push(url);
              const raw = pages.get(url);
              if (!raw) throw new Error("Unexpected fixture request " + url);
              return raw;
            }),
          onBatch: () => Effect.die("Incomplete census must not emit"),
        }),
      ),
    2,
  );
  expect(requested).toEqual([OEM_ARRIVALS, OEM_MAKES]);
  expect(result.status).toBe("paused");
  expect(result.cursor.state.phase).toBe("menus");
  expect(result.pagesProcessed).toBe(2);
  expect(result.count).toBe(0);
});

test.each(["paused", "complete"] as const)(
  "OEM soak refuses %s without valid progress",
  async (status) => {
    await expect(
      soakOemInventory(async () => ({
        source: "oem",
        status,
        cursor: OemCursor.initial(),
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
