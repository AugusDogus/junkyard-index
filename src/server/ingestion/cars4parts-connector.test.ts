import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { streamCars4PartsInventory } from "./cars4parts-connector";
import {
  Cars4PartsCursor,
  CARS4PARTS_MAX_TOTAL_BYTES,
} from "./cars4parts-cursor";
import {
  CARS4PARTS_INVENTORY,
  CARS4PARTS_MAX_BODY_BYTES,
} from "./cars4parts-html";
import { cars4partsHash, parseCars4PartsInventory } from "./cars4parts-parser";
import { Cars4PartsResult } from "./cars4parts-result";
import {
  cars4partsFixture,
  cars4partsTestContract,
  cars4partsTestPage,
  cars4partsTestRecord,
  cars4partsTestResults,
} from "./cars4parts-test-fixtures";
import type { Cars4PartsCanonicalVehicle } from "./cars4parts-transform";

const mazda = cars4partsTestRecord("mazda3"),
  quest = cars4partsTestRecord("quest");
function replay(changeClosing = false) {
  const requested: string[] = [];
  let resultsRead = 0;
  const readPage = (url: string) => {
    requested.push(url);
    if (url === CARS4PARTS_INVENTORY)
      return Effect.succeed(cars4partsFixture("inventory"));
    if (URL.parse(url)?.pathname === "/wp-admin/admin-ajax.php") {
      resultsRead++;
      const result = cars4partsTestResults([mazda, quest]);
      return Effect.succeed(
        changeClosing && resultsRead > 1
          ? result.replace("2005 Mazda Mazda3", "2006 Mazda Mazda3")
          : result,
      );
    }
    if (url === mazda.destination)
      return Effect.succeed(cars4partsFixture("mazda3"));
    if (url === quest.destination)
      return Effect.succeed(cars4partsFixture("quest"));
    return Effect.fail(
      Cars4PartsResult.error("test reader", "Unexpected URL " + url),
    );
  };
  return { readPage, requested };
}
const previousUniqueInventory = { heyworth: null, armington: null };
describe("Cars4Parts durable native traversal", () => {
  test("resumes serialized checkpoints and emits only after the closing semantic census", async () => {
    const reader = replay();
    const batches: Cars4PartsCanonicalVehicle[][] = [];
    const options = {
      contract: cars4partsTestContract,
      previousUniqueInventory,
      readPage: reader.readPage,
      maxPages: 2,
      onBatch: (batch: Cars4PartsCanonicalVehicle[]) =>
        Effect.sync(() => {
          batches.push(batch);
        }),
    };
    const first = await Effect.runPromise(streamCars4PartsInventory(options));
    expect(first.status).toBe("paused");
    expect(first.cursor.phase).toBe("leaves");
    expect(batches).toHaveLength(0);
    const second = await Effect.runPromise(
      streamCars4PartsInventory({
        ...options,
        startCursor: JSON.parse(JSON.stringify(first.cursor)),
      }),
    );
    expect(second.cursor.phase).toBe("closing");
    expect(batches).toHaveLength(0);
    const final = await Effect.runPromise(
      streamCars4PartsInventory({
        ...options,
        startCursor: JSON.parse(JSON.stringify(second.cursor)),
      }),
    );
    expect(final.status).toBe("complete");
    expect(final.count).toBe(2);
    expect(final.accounting).toEqual({
      recordsProcessed: 2,
      recordsRejected: 0,
      recordsExcluded: 0,
      duplicateVehicles: 0,
    });
    expect(batches).toHaveLength(1);
    expect(reader.requested).toHaveLength(5);
    expect(
      URL.parse(reader.requested.at(-1) ?? "")?.searchParams.has("page"),
    ).toBe(false);
    const done = await Effect.runPromise(
      streamCars4PartsInventory({ ...options, startCursor: final.cursor }),
    );
    expect(done.count).toBe(0);
    expect(reader.requested).toHaveLength(5);
    expect(batches).toHaveLength(1);
  });
  test("refuses a changed closing catalog before any batch or yard emission", async () => {
    const reader = replay(true);
    let emissions = 0;
    const result = await Effect.runPromise(
      Effect.either(
        streamCars4PartsInventory({
          contract: cars4partsTestContract,
          previousUniqueInventory,
          readPage: reader.readPage,
          onBatch: () =>
            Effect.sync(() => {
              emissions++;
            }),
          onYards: () =>
            Effect.sync(() => {
              emissions++;
            }),
        }),
      ),
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left")
      expect(result.left.message).toContain(
        "Closing native result graph changed",
      );
    expect(emissions).toBe(0);
  });
  test("rejects modified or differently scoped checkpoints before reading", async () => {
    const reader = replay();
    const cursor = Cars4PartsCursor.initial(cars4partsTestContract);
    const result = await Effect.runPromise(
      Effect.either(
        streamCars4PartsInventory({
          contract: cars4partsTestContract,
          previousUniqueInventory,
          startCursor: { ...cursor, requests: 1 },
          readPage: reader.readPage,
          onBatch: () => Effect.void,
        }),
      ),
    );
    expect(result._tag).toBe("Left");
    expect(reader.requested).toHaveLength(0);
    const changed = {
      ...cars4partsTestContract,
      heyworth: {
        ...cars4partsTestContract.heyworth,
        minimumUniqueInventory: 2,
      },
    };
    expect(Cars4PartsCursor.parse(cursor, changed).ok).toBe(false);
  });
  test("enforces caller minimums before any emission", async () => {
    const reader = replay();
    const contract = {
      ...cars4partsTestContract,
      heyworth: {
        ...cars4partsTestContract.heyworth,
        minimumUniqueInventory: 2,
      },
    };
    let emitted = false;
    const result = await Effect.runPromise(
      Effect.either(
        streamCars4PartsInventory({
          contract,
          previousUniqueInventory,
          readPage: reader.readPage,
          onBatch: () =>
            Effect.sync(() => {
              emitted = true;
            }),
        }),
      ),
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left")
      expect(result.left.message).toContain("root-supplied minimum 2");
    expect(emitted).toBe(false);
  });
  test("reserves the full maximum next response before dispatch within the total byte ceiling", async () => {
    const inventory = parseCars4PartsInventory(cars4partsFixture("inventory"));
    if (!inventory.ok) throw new Error(inventory.error.message);
    const graph = Array.from({ length: 64 }, (_, index) => index + 1);
    const page = cars4partsTestPage([mazda]);
    const cursor = Cars4PartsCursor.checkpoint(
      {
        ...Cars4PartsCursor.initial(cars4partsTestContract),
        phase: "opening",
        requests: 64,
        bytes: CARS4PARTS_MAX_TOTAL_BYTES - CARS4PARTS_MAX_BODY_BYTES + 1,
        makes: inventory.value.makes,
        inventoryHash: inventory.value.hash,
        pages: graph.slice(0, -1).map((number) => ({
          ...page,
          page: number,
          pages: graph,
          hash: cars4partsHash({ pages: graph, rows: page.rows }),
        })),
      },
      cars4partsTestContract,
    );
    if (!cursor.ok) throw new Error(cursor.error.message);
    const reader = replay();
    const result = await Effect.runPromise(
      Effect.either(
        streamCars4PartsInventory({
          contract: cars4partsTestContract,
          previousUniqueInventory,
          startCursor: cursor.value,
          readPage: reader.readPage,
          onBatch: () => Effect.void,
        }),
      ),
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left")
      expect(result.left.message).toContain(
        "2 MiB maximum next response allowance",
      );
    expect(reader.requested).toHaveLength(0);
  });
});
