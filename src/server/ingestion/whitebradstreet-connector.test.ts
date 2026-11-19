import { afterEach, expect, test } from "bun:test";
import { Effect, Fiber, TestClock, TestContext } from "effect";
import {
  streamWhitebradstreetInventory,
  streamWhitebradstreetInventoryWithRequestGate,
} from "./whitebradstreet-connector";
import {
  WhitebradstreetCursorSchema,
  type WhitebradstreetCursor,
} from "./whitebradstreet-cursor";
import {
  whitebradstreetControl,
  whitebradstreetPage,
} from "./whitebradstreet-test-fixtures";
import type { WhitebradstreetCanonicalVehicle } from "./whitebradstreet-transform";
import { WHITEBRADSTREET_YARD } from "./whitebradstreet-yard-metadata";
import type { TruckPartsCatalogRecord } from "./truck-parts-catalog";
import { whitebradstreetRecord } from "./whitebradstreet-test-fixtures";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
function inventory(
  options: {
    total?: number;
    rewrite?: (body: string, page: number, detail: boolean) => string;
    response?: (body: string) => Response;
    patch?: (
      record: TruckPartsCatalogRecord,
      offset: number,
    ) => TruckPartsCatalogRecord;
  } = {},
) {
  const requests: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(url.origin).toBe("https://white-bradstreet.com");
      const detail = url.pathname === "/truck-description/";
      const page = Number(url.searchParams.get("page_number") ?? 1);
      requests.push(url.href);
      const raw = detail
        ? whitebradstreetControl()
        : whitebradstreetPage(page, options.total ?? 26, options.patch);
      const body = options.rewrite?.(raw, page, detail) ?? raw;
      return (
        options.response?.(body) ??
        new Response(body, { headers: { "content-type": "text/html" } })
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}
const chunk = (
  cursor?: WhitebradstreetCursor,
  maxPages = 1,
  onBatch = (_batch: WhitebradstreetCanonicalVehicle[]) => Effect.void,
) =>
  streamWhitebradstreetInventoryWithRequestGate(
    { startCursor: cursor, maxPages, onBatch },
    gate,
  );
const run = (...args: Parameters<typeof chunk>) =>
  Effect.runPromise(chunk(...args));

test("White & Bradstreet pauses, roundtrips and resumes without duplicate emissions", async () => {
  const requests = inventory();
  const vehicles: WhitebradstreetCanonicalVehicle[] = [];
  const onBatch = (batch: WhitebradstreetCanonicalVehicle[]) =>
    Effect.sync(() => {
      vehicles.push(...batch);
    });
  const first = await run(undefined, 1, onBatch);
  expect(first).toMatchObject({
    status: "paused",
    count: 25,
    pagesProcessed: 1,
  });
  const cursor = WhitebradstreetCursorSchema.parse(
    JSON.parse(JSON.stringify(first.cursor)),
  );
  const yards: (typeof WHITEBRADSTREET_YARD)[] = [];
  const last = await Effect.runPromise(
    streamWhitebradstreetInventoryWithRequestGate(
      {
        startCursor: cursor,
        maxPages: 1,
        onBatch,
        onYards: (batch) =>
          Effect.sync(() => {
            yards.push(...batch);
          }),
      },
      gate,
    ),
  );
  expect(last).toMatchObject({
    status: "complete",
    count: 1,
    pagesProcessed: 1,
  });
  expect(new Set(vehicles.map((v) => v.vin)).size).toBe(26);
  expect(yards).toEqual([WHITEBRADSTREET_YARD]);
  expect(
    requests.filter((url) => url.endsWith("?f-condition=nw")).length,
  ).toBeGreaterThan(1);
  const before = requests.length;
  expect((await run(last.cursor)).count).toBe(0);
  expect(requests.length).toBe(before);
});

test("White & Bradstreet retains rejected presence and carries the 10% limit across chunks", async () => {
  inventory({
    total: 50,
    patch: (record, offset) =>
      offset >= 20 && offset <= 25 ? { ...record, model: "Unknown" } : record,
  });
  const first = await run();
  expect(first).toMatchObject({
    count: 20,
    accounting: { recordsProcessed: 25, recordsRejected: 5 },
  });
  expect(first.observedVins).toHaveLength(5);
  let emitted = false;
  await expect(
    run(first.cursor, 1, () =>
      Effect.sync(() => {
        emitted = true;
      }),
    ),
  ).rejects.toThrow("10% rejection limit");
  expect(emitted).toBe(false);
});

test("White & Bradstreet carries the 25% canonical duplicate limit across chunks", async () => {
  inventory({
    total: 50,
    patch: (record, offset) =>
      offset >= 13 && offset <= 25
        ? { ...record, vin: whitebradstreetRecord.vin }
        : record,
  });
  const first = await run();
  expect(first).toMatchObject({
    count: 13,
    accounting: { duplicateVehicles: 12 },
  });
  await expect(run(first.cursor)).rejects.toThrow("25% duplicate limit");
});

test("White & Bradstreet accepts the exact required-reject and duplicate limits", async () => {
  inventory({
    total: 20,
    patch: (record, offset) => {
      if (offset >= 18) return { ...record, model: "" };
      return offset >= 13
        ? { ...record, vin: whitebradstreetRecord.vin }
        : record;
    },
  });
  expect(await run()).toMatchObject({
    status: "complete",
    count: 13,
    accounting: {
      recordsProcessed: 20,
      recordsRejected: 2,
      duplicateVehicles: 5,
    },
  });
});

test.each([
  ["changed total", (_body: string) => whitebradstreetPage(2, 27)],
  ["repeated native ID", (body: string) => body.replaceAll("193564", "193589")],
  [
    "conflicting canonical identity",
    (body: string) =>
      body
        .replaceAll("1XPHD49X0AD113784", whitebradstreetRecord.vin)
        .replaceAll("<p>386</p>", "<p>387</p>"),
  ],
] as const)(
  "White & Bradstreet blocks %s across page boundaries",
  async (_name, rewrite) => {
    inventory({
      rewrite: (body, page, detail) =>
        !detail && page === 2 ? rewrite(body) : body,
    });
    const first = await run();
    await expect(run(first.cursor)).rejects.toThrow(
      "Previously published inventory is preserved",
    );
  },
);

test("White & Bradstreet checks the full native prefix before resumed emissions", async () => {
  inventory();
  const first = await run();
  inventory({
    rewrite: (body, page, detail) =>
      !detail && page === 1
        ? body.replaceAll("<p>386</p>", "<p>387</p>")
        : body,
  });
  let emitted = false;
  await expect(
    run(first.cursor, 1, () =>
      Effect.sync(() => {
        emitted = true;
      }),
    ),
  ).rejects.toThrow("changed since the checkpoint");
  expect(emitted).toBe(false);
});

test("White & Bradstreet rechecks all pages at terminal before callbacks", async () => {
  let firstPageReads = 0;
  inventory({
    rewrite: (body, page, detail) => {
      if (!detail && page === 1 && ++firstPageReads > 1)
        return body.replaceAll("<p>386</p>", "<p>387</p>");
      return body;
    },
  });
  let emitted = false;
  await expect(
    run(undefined, 2, () =>
      Effect.sync(() => {
        emitted = true;
      }),
    ),
  ).rejects.toThrow("changed during enumeration");
  expect(emitted).toBe(false);
});

test.each([
  ["changed yard", (body: string) => body.replaceAll("04330", "04331")],
  [
    "changed map",
    (body: string) => body.replaceAll("Ufxo1ycqWZjpHmtX8", "another-map"),
  ],
  [
    "changed phone",
    (body: string) => body.replaceAll("207-622-2622", "207-622-2623"),
  ],
  [
    "retail scope",
    (body: string) =>
      body.replaceAll("Condition: Salvage", "Condition: Complete"),
  ],
  [
    "retail detail",
    (body: string) => body.replaceAll("Now Wrecking", "Complete"),
  ],
  [
    "conflicting detail VIN",
    (body: string) =>
      body.replace("<p>1XPHD49X0AD113809</p>", "<p>1XPHD49X0AD113808</p>"),
  ],
  [
    "conflicting detail model",
    (body: string) => body.replace("<p>386</p>", "<p>387</p>"),
  ],
  ["truncated HTML", (body: string) => body.replace("</html>", "")],
] as const)(
  "White & Bradstreet blocks %s before callbacks",
  async (_name, rewrite) => {
    inventory({
      rewrite: (body, _page, detail) =>
        _name.includes("detail")
          ? detail
            ? rewrite(body)
            : body
          : rewrite(body),
    });
    let emitted = false;
    await expect(
      run(undefined, 1, () =>
        Effect.sync(() => {
          emitted = true;
        }),
      ),
    ).rejects.toThrow("Previously published inventory is preserved");
    expect(emitted).toBe(false);
  },
);

// Production crawls at one request per 1.6 seconds hit Cloudflare HTTP 429
// mid-traversal (page 5 or 9 of 16). Live reads spaced four seconds apart
// completed all 16 native pages plus a replay without a 429.
const throttled = (retryAfter: string | null) =>
  new Response("rate limited", {
    status: 429,
    headers: {
      "content-type": "text/html",
      ...(retryAfter === null ? {} : { "retry-after": retryAfter }),
    },
  });
const html = (body: string) =>
  new Response(body, { headers: { "content-type": "text/html" } });
const underTestClock = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestContext.TestContext)));
const settle = Effect.promise(
  () => new Promise<void>((resolve) => setTimeout(resolve, 5)),
);

test("White & Bradstreet spaces native requests at least four seconds apart", async () => {
  const requests = inventory();
  const result = await underTestClock(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        streamWhitebradstreetInventory({
          maxPages: 2,
          onBatch: () => Effect.void,
        }),
      );
      yield* settle;
      expect(requests).toHaveLength(1);
      yield* TestClock.adjust("3999 millis");
      yield* settle;
      expect(requests).toHaveLength(1);
      for (let request = 2; request <= 5; request++) {
        yield* TestClock.adjust("1 millis");
        yield* settle;
        expect(requests).toHaveLength(request);
        yield* TestClock.adjust("3999 millis");
        yield* settle;
        expect(requests).toHaveLength(request);
      }
      return yield* Fiber.join(fiber);
    }),
  );
  expect(result).toMatchObject({ status: "complete", count: 26 });
});

test.each([
  ["Retry-After", "20", 20_000],
  ["no Retry-After", null, 15_000],
] as const)(
  "White & Bradstreet waits out HTTP 429 with %s and retries the same page",
  async (_name, retryAfter, waitMs) => {
    let limited = false;
    const requests = inventory({
      response: (body) => {
        if (limited) return html(body);
        limited = true;
        return throttled(retryAfter);
      },
    });
    const result = await underTestClock(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(chunk());
        yield* settle;
        expect(requests).toHaveLength(1);
        yield* TestClock.adjust(waitMs - 1);
        yield* settle;
        expect(requests).toHaveLength(1);
        yield* TestClock.adjust(1);
        yield* settle;
        expect(requests[1]).toBe(requests[0]);
        yield* TestClock.adjust("1 minute");
        return yield* Fiber.join(fiber);
      }),
    );
    expect(result).toMatchObject({ status: "paused", count: 25 });
  },
);

test("White & Bradstreet stops after three rate-limited attempts and keeps the checkpoint", async () => {
  const requests = inventory({ response: () => throttled(null) });
  let emitted = false;
  const outcome = await underTestClock(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        Effect.either(
          chunk(undefined, 1, () =>
            Effect.sync(() => {
              emitted = true;
            }),
          ),
        ),
      );
      yield* settle;
      yield* TestClock.adjust("15 seconds");
      yield* settle;
      yield* TestClock.adjust("30 seconds");
      yield* settle;
      return yield* Fiber.join(fiber);
    }),
  );
  expect(requests).toHaveLength(3);
  expect(emitted).toBe(false);
  expect(outcome._tag).toBe("Left");
  if (outcome._tag === "Left")
    expect(outcome.left.message).toContain(
      "Previously published inventory is preserved",
    );
});

test("White & Bradstreet fails fast when Retry-After exceeds the in-chunk wait budget", async () => {
  const requests = inventory({ response: () => throttled("3600") });
  await expect(run()).rejects.toThrow("asked to wait 3600 seconds");
  expect(requests).toHaveLength(1);
});

const httpBoundaries: ResponseInit[] = [
  { status: 403 },
  { status: 206 },
  { status: 500 },
  { headers: { "content-type": "application/json" } },
  {
    headers: { "content-type": "text/html", "content-range": "bytes 0-10/100" },
  },
  { headers: { "content-type": "text/html", "content-length": "1" } },
];
test.each(httpBoundaries)(
  "White & Bradstreet rejects failed HTTP boundaries without retries (%#)",
  async (init) => {
    const requests = inventory({
      response: (body) =>
        new Response(body, {
          headers: { "content-type": "text/html" },
          ...init,
        }),
    });
    await expect(run()).rejects.toThrow(
      "Previously published inventory is preserved",
    );
    expect(requests).toHaveLength(1);
  },
);

test.each([
  [
    "redirect",
    (body: string) => {
      const response = new Response(body, {
        headers: { "content-type": "text/html" },
      });
      Object.defineProperty(response, "url", { value: "https://example.com/" });
      return response;
    },
  ],
  [
    "missing body",
    (_body: string) =>
      new Response(null, { headers: { "content-type": "text/html" } }),
  ],
  [
    "oversized body",
    (_body: string) =>
      new Response("x".repeat(4 * 1024 * 1024 + 1), {
        headers: { "content-type": "text/html" },
      }),
  ],
  [
    "invalid UTF-8",
    (_body: string) =>
      new Response(new Uint8Array([255]), {
        headers: { "content-type": "text/html" },
      }),
  ],
  [
    "network failure",
    (_body: string): Response => {
      throw new TypeError("Connection failed");
    },
  ],
] as const)(
  "White & Bradstreet rejects %s without retries",
  async (_name, response) => {
    const requests = inventory({ response });
    await expect(run()).rejects.toThrow(
      "Previously published inventory is preserved",
    );
    expect(requests).toHaveLength(1);
  },
);

test("White & Bradstreet rejects tampered checkpoints and invalid budgets before requests", async () => {
  const requests = inventory();
  for (const budget of [0, -1, 33, 1.5, NaN])
    await expect(run(undefined, budget)).rejects.toThrow("checkpoint");
  expect(requests).toHaveLength(0);
  const first = await run();
  if (first.cursor.phase !== "pages")
    throw new Error("Expected paused fixture");
  const cursor = first.cursor;
  for (const invalid of [
    { ...cursor, source: "rivervalley" },
    { ...cursor, extra: true },
    { ...cursor, nextPage: 3 },
    { ...cursor, processed: 24 },
    { ...cursor, total: 25 },
    { ...cursor, emitted: 24 },
    { ...cursor, rejected: 1 },
    { ...cursor, duplicates: 1 },
    { ...cursor, seen: cursor.seen.slice(1) },
    { ...cursor, hashes: [] },
    { source: "whitebradstreet", phase: "complete", nextPage: 2 },
  ])
    expect(WhitebradstreetCursorSchema.safeParse(invalid).success).toBe(false);
  const changed = WhitebradstreetCursorSchema.parse({
    ...cursor,
    hashes: ["a".repeat(64)],
  });
  await expect(run(changed)).rejects.toThrow("changed since the checkpoint");
});
