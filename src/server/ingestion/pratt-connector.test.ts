import { afterEach, expect, test } from "bun:test";
import { Effect, Either, Fiber, TestClock, TestContext } from "effect";
import {
  streamPrattInventory,
  streamPrattInventoryFromProvider,
  type PrattStreamResult,
} from "./pratt-connector";
import { PrattCursor, PRATT_MAX_TOTAL_BYTES } from "./pratt-cursor";
import { PRATT_ORIGIN, PRATT_MAKES, PRATT_ARRIVALS } from "./pratt-html";
import { PrattResult } from "./pratt-result";
import {
  prattFixture,
  prattFixtureContract,
  prattOnlyControl,
} from "./pratt-test-fixtures";
import { runWithQueuedHost } from "./provider-host-test-support";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function harness() {
  const requests: string[] = [],
    batches: string[][] = [];
  const documents = new Map([
    [PRATT_ORIGIN + "/", prattFixture("root.html")],
    [PRATT_ARRIVALS, prattFixture("arrivals.html")],
    [
      PRATT_MAKES,
      prattOnlyControl(
        prattFixture("makes.html"),
        PRATT_ORIGIN + "/parts/LEXUS",
      ),
    ],
    [
      PRATT_ORIGIN + "/parts/LEXUS",
      prattOnlyControl(
        prattFixture("models-lexus.html"),
        "//prattsautosalvage.com/parts/LEXUS/LEXUS_LS460/",
      ),
    ],
    [
      PRATT_ORIGIN + "/parts/LEXUS/LEXUS_LS460/",
      prattFixture("model-lexus.html"),
    ],
  ]);
  const options = {
    contract: prattFixtureContract,
    previousUniqueInventory: null,
    readPage: (url: string) => {
      requests.push(url);
      const raw = documents.get(url);
      return raw === undefined
        ? Effect.fail(
            PrattResult.error("saved reader", "No frozen fixture for " + url),
          )
        : Effect.succeed(raw);
    },
    onBatch: (vehicles: { vin: string }[]) =>
      Effect.sync(() => {
        batches.push(vehicles.map((vehicle) => vehicle.vin));
      }),
  };
  return { options, requests, batches, documents };
}
test("Pratt resumes the exact native graph and emits only after all literal controls close", async () => {
  const run = harness();
  const first = await Effect.runPromise(
    streamPrattInventory({ ...run.options, maxPages: 4 }),
  );
  expect(first.status).toBe("paused");
  expect(first.cursor.phase).toBe("models");
  expect(run.batches).toEqual([]);
  const wire = PrattCursor.serialize(first.cursor, prattFixtureContract);
  expect(wire.ok).toBe(true);
  if (!wire.ok) throw new Error(wire.error.message);
  const resumed = PrattCursor.fromWire(wire.value, prattFixtureContract);
  if (!resumed.ok) throw new Error(resumed.error.message);
  const last = await Effect.runPromise(
    streamPrattInventory({
      ...run.options,
      startCursor: resumed.value,
      maxPages: 1,
    }),
  );
  expect(last.status).toBe("complete");
  expect(last.count).toBe(61);
  expect(run.requests).toHaveLength(5);
  expect(run.batches).toHaveLength(1);
  expect(last.accounting).toEqual({
    recordsProcessed: 62,
    recordsRejected: 0,
    recordsExcluded: 0,
    duplicateVehicles: 1,
  });
});
test("Pratt fails closed on unread continuation and source validation without emitting", async () => {
  for (const variant of ["continuation", "minimum"] as const) {
    const run = harness();
    if (variant === "continuation")
      run.documents.set(
        PRATT_ORIGIN + "/parts/LEXUS/LEXUS_LS460/",
        prattFixture("model-lexus.html").replace(
          '<div class="card-deck">',
          '<a href="?page=2" rel="next">Next</a><div class="card-deck">',
        ),
      );
    const outcome = await Effect.runPromise(
      Effect.either(
        streamPrattInventory({
          ...run.options,
          contract: {
            ...prattFixtureContract,
            minimumUniqueInventory: variant === "minimum" ? 100 : 1,
          },
        }),
      ),
    );
    expect(outcome._tag).toBe("Left");
    expect(run.batches).toEqual([]);
  }
});
test("Pratt rejects changed root contracts, malformed cursors and unowned graph controls before reads", async () => {
  const run = harness();
  const initial = PrattCursor.initial(prattFixtureContract);
  expect(
    PrattCursor.parse(
      { ...initial, checksum: "0".repeat(64) },
      prattFixtureContract,
    ).ok,
  ).toBe(false);
  expect(PrattCursor.fromWire("{", prattFixtureContract).ok).toBe(false);
  expect(
    PrattCursor.parse(initial, {
      ...prattFixtureContract,
      minimumUniqueInventory: 2,
    }).ok,
  ).toBe(false);
  const result = await Effect.runPromise(
    Effect.either(
      streamPrattInventory({
        ...run.options,
        startCursor: { ...initial, phase: "ready" },
      }),
    ),
  );
  expect(result._tag).toBe("Left");
  expect(run.requests).toEqual([]);
});
test("Pratt whole-run byte budget blocks another read without emitting", async () => {
  const run = harness();
  const first = await Effect.runPromise(
    streamPrattInventory({ ...run.options, maxPages: 4 }),
  );
  const checkpoint = PrattCursor.checkpoint(
    { ...first.cursor, bytes: PRATT_MAX_TOTAL_BYTES - 1 },
    prattFixtureContract,
  );
  if (!checkpoint.ok) throw new Error(checkpoint.error.message);
  const before = run.requests.length;
  const result = await Effect.runPromise(
    Effect.either(
      streamPrattInventory({ ...run.options, startCursor: checkpoint.value }),
    ),
  );
  expect(result._tag).toBe("Left");
  expect(run.requests).toHaveLength(before);
  expect(run.batches).toEqual([]);
});
test("Pratt chunk deadline interrupts an unfinished reader and preserves callback isolation", async () => {
  const run = harness();
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        streamPrattInventory({ ...run.options, readPage: () => Effect.never }),
      );
      yield* TestClock.adjust("3 minutes");
      return yield* Effect.either(Fiber.join(fiber));
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(result._tag).toBe("Left");
  if (result._tag === "Left")
    expect(result.left.message).toContain("Three-minute limit");
  expect(run.batches).toEqual([]);
});

test("Pratt completes a full crawl when every request waits two minutes for a shared host turn", async () => {
  // Production URG queue on 2026-11-19: about 20 sources shared one lease, so
  // each request waited about two minutes for its turn. The live reader runs
  // against the frozen documents so its own shared host slot is exercised.
  const run = harness();
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      run.requests.push(url);
      const body = run.documents.get(url);
      if (body === undefined)
        throw new Error("Unexpected fixture request " + url);
      return new Response(body, { headers: { "content-type": "text/html" } });
    },
    { preconnect: originalFetch.preconnect },
  );
  let cursor: unknown = undefined;
  const pages: number[] = [];
  let result: PrattStreamResult | undefined;
  while (result?.status !== "complete") {
    const chunk = await runWithQueuedHost(
      streamPrattInventoryFromProvider({
        ...run.options,
        startCursor: cursor,
        maxPages: 8,
      }),
      { turnWaitMs: 2 * 60_000 },
    );
    if (Either.isLeft(chunk.result)) throw chunk.result.left;
    result = chunk.result.right;
    pages.push(result.pagesProcessed);
    const wire = PrattCursor.serialize(result.cursor, prattFixtureContract);
    if (!wire.ok) throw new Error(wire.error.message);
    const resumed = PrattCursor.fromWire(wire.value, prattFixtureContract);
    if (!resumed.ok) throw new Error(resumed.error.message);
    cursor = resumed.value;
    // Every chunk returns its checkpoint and releases each lease in time.
    expect(result.pagesProcessed).toBeGreaterThan(0);
    expect(chunk.elapsedMs).toBeLessThanOrEqual(6 * 60_000);
    expect(chunk.turns.every((turn) => turn.releasedAt !== null)).toBe(true);
  }
  expect(pages).toEqual([2, 2, 1]);
  expect(result.count).toBe(61);
  expect(run.requests).toHaveLength(5);
  expect(run.batches).toHaveLength(1);
}, 120_000);
