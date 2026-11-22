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
  prattGzipFixture,
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
// Every donor VIN on the Nov 19 raw-ampersand Town & Country capture (31
// cards; one blank-VIN card stays a reject). The literal "_-and_" control
// returned an explicit empty despite its badge.
const townAndCountryVins = [
  "1A4GP44R26B567943",
  "1C4GP45R84B561565",
  "1C4GP45RX5B302741",
  "2A4RR5D11AR104673",
  "2A4RR5D19AR235771",
  "2A4RR6DXXAR183318",
  "2A4RR8DG7BR659232",
  "2A8HR44H98R643148",
  "2A8HR54149R673653",
  "2A8HR54P28R812259",
  "2A8HR54P78R610310",
  "2A8HR54PX8R719876",
  "2A8HR64X48R838805",
  "2C4GP54L54R505846",
  "2C4GP54L83R191060",
  "2C4RC1AG9GR142282",
  "2C4RC1BG0ER373714",
  "2C4RC1BG3DR604488",
  "2C4RC1BG4ER207342",
  "2C4RC1BG4ER218762",
  "2C4RC1BG7CR126512",
  "2C4RC1BG8ER221504",
  "2C4RC1BG9ER195401",
  "2C4RC1BGXFR510420",
  "2C4RC1CG2DR780012",
  "2C4RC1CG6CR124992",
  "2C4RC1CGXER224807",
  "2C4RC1GG1FR708831",
  "2C8GP64L63R123084",
  "2C8GP64L93R113875",
];
const literalTownAndCountry =
  PRATT_ORIGIN + "/parts/CHRYSLER/TOWN_-and_COUNTRY/";
const rawTownAndCountry = PRATT_ORIGIN + "/parts/CHRYSLER/TOWN_&_COUNTRY/";
function townAndCountryHarness(rawAmpersandBody: string) {
  const run = harness();
  run.documents.clear();
  run.documents.set(PRATT_ORIGIN + "/", prattFixture("root.html"));
  run.documents.set(PRATT_ARRIVALS, prattFixture("arrivals.html"));
  run.documents.set(
    PRATT_MAKES,
    prattOnlyControl(
      prattFixture("makes.html"),
      PRATT_ORIGIN + "/parts/CHRYSLER",
    ),
  );
  run.documents.set(
    PRATT_ORIGIN + "/parts/CHRYSLER",
    prattOnlyControl(
      prattGzipFixture("models-chrysler.html.gz"),
      "//prattsautosalvage.com/parts/CHRYSLER/TOWN_-and_COUNTRY/",
    ),
  );
  // The saved Nov 13 literal-route response is the explicit empty.
  run.documents.set(literalTownAndCountry, prattFixture("empty-chrysler.html"));
  run.documents.set(rawTownAndCountry, rawAmpersandBody);
  return run;
}
async function crawl(run: ReturnType<typeof harness>) {
  let cursor: unknown = undefined;
  for (;;) {
    const chunk = await Effect.runPromise(
      Effect.either(
        streamPrattInventory({ ...run.options, startCursor: cursor }),
      ),
    );
    if (Either.isLeft(chunk) || chunk.right.status === "complete") return chunk;
    cursor = chunk.right.cursor;
  }
}
test("Pratt reads the badged Town & Country control by its raw ampersand route and accepts its donors", async () => {
  const run = townAndCountryHarness(
    prattGzipFixture("model-town-and-country.html.gz"),
  );
  const result = await crawl(run);
  const accepted = run.batches.flat();
  expect(townAndCountryVins.filter((vin) => !accepted.includes(vin))).toEqual(
    [],
  );
  expect(run.requests).toContain(rawTownAndCountry);
  expect(run.requests).not.toContain(literalTownAndCountry);
  expect(run.requests).toHaveLength(5);
  if (Either.isLeft(result)) throw new Error(result.left.message);
  expect(result.right.status).toBe("complete");
  expect(run.batches).toHaveLength(1);
  expect(result.right.count).toBe(new Set(accepted).size);
  expect(result.right.accounting.recordsProcessed).toBe(31 + 60);
});
test("Pratt refuses to publish when the badged Town & Country control is still an explicit empty", async () => {
  const run = townAndCountryHarness(prattFixture("empty-chrysler.html"));
  const result = await crawl(run);
  expect(Either.isLeft(result)).toBe(true);
  if (Either.isLeft(result)) {
    expect(result.left.message).toContain(
      "model /parts/CHRYSLER/TOWN_-and_COUNTRY/ advertises 31 donors but /parts/CHRYSLER/TOWN_&_COUNTRY/ returned an explicit",
    );
    expect(result.left.message).toContain("Prior inventory is preserved");
  }
  expect(run.batches).toEqual([]);
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

test("Pratt retries a transient failure and returns its checkpoint before slow pages outrun the work deadline", async () => {
  // Production on 2026-11-22: the shared server answered HTTP 500 on one page
  // of about 520 and pages took up to 20 seconds. One failure used to fail the
  // run; retries must not push the chunk past its three-minute work deadline.
  const run = harness();
  let makesAttempts = 0;
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      run.requests.push(url);
      if (url === PRATT_MAKES && ++makesAttempts < 3)
        return new Response("busy", { status: 503 });
      const body = run.documents.get(url);
      if (body === undefined)
        throw new Error("Unexpected fixture request " + url);
      return new Response(body, { headers: { "content-type": "text/html" } });
    },
    { preconnect: originalFetch.preconnect },
  );
  const first = await runWithQueuedHost(
    streamPrattInventoryFromProvider({ ...run.options, maxPages: 8 }),
    { turnWaitMs: 0, requestMs: () => 19_000 },
  );
  if (Either.isLeft(first.result)) throw first.result.left;
  expect(first.result.right.status).toBe("paused");
  expect(first.result.right.pagesProcessed).toBe(4);
  expect(makesAttempts).toBe(3);
  expect(run.batches).toEqual([]);
  const wire = PrattCursor.serialize(
    first.result.right.cursor,
    prattFixtureContract,
  );
  if (!wire.ok) throw new Error(wire.error.message);
  const resumed = PrattCursor.fromWire(wire.value, prattFixtureContract);
  if (!resumed.ok) throw new Error(resumed.error.message);
  const second = await runWithQueuedHost(
    streamPrattInventoryFromProvider({
      ...run.options,
      startCursor: resumed.value,
      maxPages: 8,
    }),
    { turnWaitMs: 0, requestMs: () => 19_000 },
  );
  if (Either.isLeft(second.result)) throw second.result.left;
  expect(second.result.right.status).toBe("complete");
  expect(second.result.right.count).toBe(61);
  expect(run.requests).toHaveLength(7);
  expect(run.batches).toHaveLength(1);
}, 120_000);
