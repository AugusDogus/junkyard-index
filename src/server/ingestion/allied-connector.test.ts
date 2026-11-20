import { expect, test } from "bun:test";
import { Effect, Either, Fiber, TestClock, TestContext } from "effect";
import { inventoryHtmlAttribute } from "./inventory-html";
import {
  alliedFixture,
  alliedFixtureContract,
  alliedValue,
} from "./allied-test-fixtures";
import { AlliedCursor, ALLIED_MAX_TOTAL_BYTES } from "./allied-cursor";
import {
  streamAlliedInventory,
  streamAlliedInventoryFromProvider,
} from "./allied-connector";
import { AlliedResult } from "./allied-result";
import { ALLIED_ORIGIN, alliedClass, alliedElements } from "./allied-html";
import { runWithQueuedHost } from "./provider-host-test-support";

// Reduce real native directories for traversal tests only. The census test
// separately verifies the entire 45-make graph without reducing its controls.
function only(raw: string, href: string): string {
  return raw.replace(
    /(<a\b[^>]*>)[\s\S]*?<\/a>/gi,
    (literal: string, tag: string) =>
      !(inventoryHtmlAttribute(tag, "class") ?? "")
        .split(/\s+/)
        .includes("iis-center-block") ||
      inventoryHtmlAttribute(tag, "href") === href
        ? literal
        : "",
  );
}
function harness() {
  const docs = new Map([
    [ALLIED_ORIGIN + "/", alliedFixture("owner")],
    [ALLIED_ORIGIN + "/latest-arrivals/", alliedFixture("arrivals")],
    [
      ALLIED_ORIGIN + "/parts/",
      only(alliedFixture("makes"), ALLIED_ORIGIN + "/parts/ACURA"),
    ],
    [
      ALLIED_ORIGIN + "/parts/ACURA",
      only(
        alliedFixture("models-acura"),
        "//alliedautowrecking.com/parts/ACURA/ILX/",
      ),
    ],
    [ALLIED_ORIGIN + "/parts/ACURA/ILX/", alliedFixture("model-ilx")],
  ]);
  const requests: string[] = [];
  const batches: string[][] = [];
  return {
    docs,
    requests,
    batches,
    options: {
      contract: alliedFixtureContract,
      previousUniqueInventory: null,
      readPage: (url: string) => {
        requests.push(url);
        const raw = docs.get(url);
        return raw === undefined
          ? Effect.fail(
              AlliedResult.error("saved fixture", "No fixture for " + url),
            )
          : Effect.succeed(raw);
      },
      onBatch: (vehicles: { vin: string }[]) =>
        Effect.sync(() => {
          batches.push(vehicles.map((v) => v.vin));
        }),
    },
  };
}
test("Allied resumes the native graph and waits for genuine closing controls before emission", async () => {
  const h = harness();
  const first = await Effect.runPromise(
    streamAlliedInventory({ ...h.options, maxPages: 4 }),
  );
  expect(first.status).toBe("paused");
  expect(first.cursor.phase).toBe("models");
  expect(h.batches).toEqual([]);
  const wire = alliedValue(
    AlliedCursor.serialize(first.cursor, alliedFixtureContract),
  );
  const cursor = alliedValue(
    AlliedCursor.fromWire(wire, alliedFixtureContract),
  );
  const result = await Effect.runPromise(
    streamAlliedInventory({ ...h.options, startCursor: cursor, maxPages: 4 }),
  );
  expect(result.status).toBe("complete");
  expect(result.count).toBe(40);
  expect(h.requests).toHaveLength(8);
  expect(h.batches).toHaveLength(1);
  expect(result.warnings.join(" ")).toContain("not a yard total");
});
test("Allied rejects closing graph drift and protects the published inventory", async () => {
  const h = harness();
  const first = await Effect.runPromise(
    streamAlliedInventory({ ...h.options, maxPages: 4 }),
  );
  const second = await Effect.runPromise(
    streamAlliedInventory({
      ...h.options,
      startCursor: first.cursor,
      maxPages: 2,
    }),
  );
  h.docs.set(
    ALLIED_ORIGIN + "/parts/",
    only(alliedFixture("makes"), ALLIED_ORIGIN + "/parts/ACURA").replace(
      ">11</span>",
      ">12</span>",
    ),
  );
  const result = await Effect.runPromise(
    Effect.either(
      streamAlliedInventory({ ...h.options, startCursor: second.cursor }),
    ),
  );
  expect(result._tag).toBe("Left");
  expect(h.batches).toEqual([]);
});
test("Allied rejects changed contracts and corrupted cursors before making requests", async () => {
  const h = harness();
  const initial = AlliedCursor.initial(alliedFixtureContract);
  const result = await Effect.runPromise(
    Effect.either(
      streamAlliedInventory({
        ...h.options,
        startCursor: { ...initial, checksum: "0".repeat(64) },
      }),
    ),
  );
  expect(result._tag).toBe("Left");
  expect(h.requests).toEqual([]);
  expect(
    AlliedCursor.parse(initial, {
      ...alliedFixtureContract,
      minimumUniqueInventory: 2,
    }).ok,
  ).toBe(false);
});

test("Allied callbacks cannot mutate the validated inventory count", async () => {
  const h = harness();
  const first = await Effect.runPromise(
    streamAlliedInventory({ ...h.options, maxPages: 4 }),
  );
  const result = await Effect.runPromise(
    streamAlliedInventory({
      ...h.options,
      startCursor: first.cursor,
      maxPages: 4,
      onBatch: (vehicles) =>
        Effect.sync(() => {
          vehicles.length = 0;
        }),
    }),
  );
  expect(result.status).toBe("complete");
  expect(result.count).toBe(40);
  expect(result.accounting.recordsProcessed).toBe(40);
});

test("Allied applies the unchanged previous complete inventory drift guard before callbacks", async () => {
  for (const previousUniqueInventory of [80, 81]) {
    const h = harness();
    const options = { ...h.options, previousUniqueInventory };
    const first = await Effect.runPromise(
      streamAlliedInventory({ ...options, maxPages: 4 }),
    );
    const result = await Effect.runPromise(
      Effect.either(
        streamAlliedInventory({
          ...options,
          startCursor: first.cursor,
          maxPages: 4,
        }),
      ),
    );
    expect(result._tag).toBe(previousUniqueInventory === 80 ? "Right" : "Left");
    expect(h.batches).toHaveLength(previousUniqueInventory === 80 ? 1 : 0);
  }
});

test("Allied refuses to publish when a badged model or make reads as an explicit empty", async () => {
  const ilx = alliedFixture("model-ilx");
  const deck = alliedElements(ilx, "div", (tag) =>
    alliedClass(tag, "card-deck"),
  )[0];
  if (!deck) throw new Error("Saved ILX card deck missing");
  const empty = ilx.replace(
    deck.body,
    '<div class="alert alert-warning" role="alert"><h3>No Results Found. Try Browsing Our Parts Or Search Again</h3></div>',
  );
  for (const [route, detail] of [
    [
      ALLIED_ORIGIN + "/parts/ACURA/ILX/",
      "model /parts/ACURA/ILX/ advertises 1 donor but /parts/ACURA/ILX/ returned an explicit",
    ],
    [
      ALLIED_ORIGIN + "/parts/ACURA",
      "make /parts/ACURA advertises 11 donors but its model directory is an explicit",
    ],
  ] as const) {
    const h = harness();
    h.docs.set(route, empty);
    let cursor: unknown = undefined;
    let outcome: Either.Either<unknown, { message: string }> | null = null;
    while (outcome === null) {
      const chunk = await Effect.runPromise(
        Effect.either(
          streamAlliedInventory({ ...h.options, startCursor: cursor }),
        ),
      );
      if (Either.isLeft(chunk) || chunk.right.status === "complete")
        outcome = chunk;
      else cursor = chunk.right.cursor;
    }
    expect(Either.isLeft(outcome)).toBe(true);
    if (Either.isLeft(outcome)) {
      expect(outcome.left.message).toContain(detail);
      expect(outcome.left.message).toContain("Prior inventory is preserved");
    }
    expect(h.batches).toEqual([]);
  }
});

test("Allied reserves a full response allowance before another GET", async () => {
  const h = harness();
  const first = await Effect.runPromise(
    streamAlliedInventory({ ...h.options, maxPages: 4 }),
  );
  const checkpoint = alliedValue(
    AlliedCursor.checkpoint(
      { ...first.cursor, bytes: ALLIED_MAX_TOTAL_BYTES - 1 },
      alliedFixtureContract,
    ),
  );
  const before = h.requests.length;
  const result = await Effect.runPromise(
    Effect.either(
      streamAlliedInventory({ ...h.options, startCursor: checkpoint }),
    ),
  );
  expect(result._tag).toBe("Left");
  expect(h.requests).toHaveLength(before);
  expect(h.batches).toEqual([]);
});

test("Allied chunk deadline interrupts a stalled reader before publication", async () => {
  const h = harness();
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        streamAlliedInventory({ ...h.options, readPage: () => Effect.never }),
      );
      yield* TestClock.adjust("4 minutes");
      return yield* Effect.either(Fiber.join(fiber));
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(result._tag).toBe("Left");
  if (result._tag === "Left")
    expect(result.left.message).toContain("Four-minute limit");
  expect(h.batches).toEqual([]);
});

test("Allied keeps advancing when every shared host turn waits minutes", async () => {
  // About 20 URG sources share one lease at 07:00, so each turn waits about
  // 2.5 minutes. The old four-minute wall deadline counted that queue time and
  // failed every chunk before it could return its first page's checkpoint.
  const h = harness();
  const original = globalThis.fetch;
  const fetched: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      const url = (input instanceof Request ? input.url : String(input))
        .replaceAll("%28", "(")
        .replaceAll("%29", ")");
      fetched.push(url);
      const raw = h.docs.get(url);
      if (raw === undefined) throw new Error("Unexpected Allied request");
      return new Response(raw, { headers: { "content-type": "text/html" } });
    },
    { preconnect: original.preconnect },
  );
  try {
    let cursor: unknown = undefined;
    const pages: number[] = [];
    let status = "paused";
    while (status !== "complete" && pages.length < 8) {
      const chunk = await runWithQueuedHost(
        streamAlliedInventoryFromProvider({
          contract: h.options.contract,
          previousUniqueInventory: null,
          onBatch: h.options.onBatch,
          startCursor: cursor,
          maxPages: 4,
        }),
        { turnWaitMs: 150_000 },
      );
      if (Either.isLeft(chunk.result)) throw chunk.result.left;
      pages.push(chunk.result.right.pagesProcessed);
      status = chunk.result.right.status;
      cursor = chunk.result.right.cursor;
      // Every chunk returns its checkpoint and releases each lease in time.
      expect(chunk.elapsedMs).toBeLessThanOrEqual(6 * 60_000);
      expect(chunk.turns.every((turn) => turn.releasedAt !== null)).toBe(true);
    }
    expect(status).toBe("complete");
    expect(pages).toEqual([2, 2, 2, 2]);
    expect(fetched).toHaveLength(8);
    expect(h.batches).toHaveLength(1);
  } finally {
    globalThis.fetch = original;
  }
}, 120_000);
