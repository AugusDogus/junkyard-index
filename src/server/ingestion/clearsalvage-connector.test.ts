import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { fetchClearsalvageCatalog } from "./clearsalvage-client";
import { streamClearsalvageInventoryWithRequestGate } from "./clearsalvage-connector";
import {
  CLEARSALVAGE_MAX_BODY_BYTES,
  CLEARSALVAGE_MAX_ELAPSED_MS,
  ClearsalvageCursor,
  ClearsalvageCursorSchema,
} from "./clearsalvage-cursor";
import { clearsalvageSaved } from "./clearsalvage-test-fixtures";
import type { ClearsalvageCanonicalVehicle } from "./clearsalvage-transform";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
function mockInventory(
  options: {
    response?: ResponseInit;
    failureAt?: number;
    lateDrift?: boolean;
    networkFailure?: boolean;
    redirected?: boolean;
    /** Host block for one native URL, as production saw on gmc-6 on 11-19. */
    blocked?: { url: string; times: number; retryAfter?: string };
  } = {},
) {
  const requests: string[] = [];
  const visits = new Map<string, number>();
  let blocks = 0;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      requests.push(url);
      if (options.networkFailure || requests.length === options.failureAt)
        throw new TypeError("Native connection failed");
      if (url === options.blocked?.url && blocks < options.blocked.times) {
        blocks++;
        return new Response("<html><body>Forbidden</body></html>", {
          status: 403,
          headers: {
            "content-type": "text/html; charset=iso-8859-1",
            ...(options.blocked.retryAfter
              ? { "retry-after": options.blocked.retryAfter }
              : {}),
          },
        });
      }
      const count = (visits.get(url) ?? 0) + 1;
      visits.set(url, count);
      const page = (
        count > 1 ? clearsalvageSaved.closing : clearsalvageSaved.opening
      ).find((page) => page.url === url);
      const donor = clearsalvageSaved.donors.find((donor) => donor.url === url);
      if (!page && !donor) throw new Error("Unexpected native request " + url);
      let body = page?.raw ?? donor?.raw ?? "";
      if (options.lateDrift && page === clearsalvageSaved.closing[1])
        body = body.replace(
          /("title"\s*:\s*\{\s*"rendered"\s*:\s*")[^"]+("\s*\})/,
          "$1CHANGED$2",
        );
      const headers = new Headers(
        page?.headers ?? { "content-type": "text/html" },
      );
      if (options.response?.headers)
        new Headers(options.response.headers).forEach((value, key) =>
          headers.set(key, value),
        );
      const response = new Response(body, { ...options.response, headers });
      if (options.redirected)
        Object.defineProperty(response, "url", {
          value: "https://example.com/",
        });
      return response;
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}
function invoke<E = never>(
  cursor: ClearsalvageCursor = ClearsalvageCursor.initial,
  maxPages = 32,
  onBatch: (
    vehicles: ClearsalvageCanonicalVehicle[],
  ) => Effect.Effect<void, E> = () => Effect.void,
) {
  return streamClearsalvageInventoryWithRequestGate(
    { startCursor: cursor, maxPages, onBatch },
    gate,
  );
}
async function prefix(units: number) {
  let cursor: ClearsalvageCursor = ClearsalvageCursor.initial;
  let used = 0;
  while (used < units) {
    const result = await Effect.runPromise(
      invoke(cursor, Math.min(32, units - used)),
    );
    expect(result.count).toBe(0);
    used += result.pagesProcessed;
    cursor = ClearsalvageCursor.parse(
      ClearsalvageCursor.serialize(result.cursor),
    );
  }
  return cursor;
}

test("Clear complete saved census resumes without early callbacks or duplicate requests", async () => {
  const requests = mockInventory();
  const vehicles: ClearsalvageCanonicalVehicle[] = [];
  let cursor: ClearsalvageCursor = ClearsalvageCursor.initial;
  let callbacks = 0,
    units = 0;
  for (let chunk = 0; chunk < 30; chunk++) {
    const result = await Effect.runPromise(
      streamClearsalvageInventoryWithRequestGate(
        {
          startCursor: cursor,
          onBatch: (batch) =>
            Effect.sync(() => {
              callbacks++;
              vehicles.push(...batch);
            }),
        },
        gate,
      ),
    );
    expect(result.pagesProcessed).toBeLessThanOrEqual(8);
    units += result.pagesProcessed;
    cursor = ClearsalvageCursor.parse(
      ClearsalvageCursor.serialize(result.cursor),
    );
    if (result.status === "complete") {
      expect(result.accounting).toEqual({
        recordsProcessed: 183,
        recordsRejected: 6,
        recordsExcluded: 0,
        duplicateVehicles: 0,
      });
      expect(result.observedVins).toEqual(["5N1AR18B08C603476"]);
      break;
    }
    expect(callbacks).toBe(0);
    expect(result.observedVins).toEqual([]);
  }
  expect(cursor.phase).toBe("complete");
  expect(callbacks).toBe(1);
  expect(vehicles).toHaveLength(177);
  expect(units).toBe(187);
  expect(requests).toHaveLength(187);
  expect((await Effect.runPromise(invoke(cursor))).pagesProcessed).toBe(0);
  expect(requests).toHaveLength(187);
});

test("Clear closing drift and a late unknown transport stop before every callback", async () => {
  for (const options of [{ lateDrift: true }, { failureAt: 186 }]) {
    const requests = mockInventory(options);
    const cursor = await prefix(185);
    let callbacks = 0;
    await expect(
      Effect.runPromise(
        invoke(cursor, 2, () =>
          Effect.sync(() => {
            callbacks++;
          }),
        ),
      ),
    ).rejects.toThrow("Prior inventory is preserved");
    expect(callbacks).toBe(0);
    expect(requests).toHaveLength(options.failureAt ?? 187);
  }
});

test.each<ResponseInit>([
  { status: 404 },
  { status: 206 },
  { headers: { "content-type": "text/html" } },
  { headers: { "content-range": "bytes 0-1/100" } },
  { headers: { "content-length": "1" } },
])(
  "Clear rejects incomplete/non-JSON transport with no retry (%#)",
  async (response) => {
    const requests = mockInventory({ response });
    await expect(Effect.runPromise(invoke())).rejects.toThrow(
      "Prior inventory is preserved",
    );
    expect(requests).toHaveLength(1);
  },
);

test("Clear rejects redirects, connection failure, foreign controls and bad budgets before expansion", async () => {
  for (const options of [{ redirected: true }, { networkFailure: true }]) {
    const requests = mockInventory(options);
    await expect(Effect.runPromise(invoke())).rejects.toThrow();
    expect(requests).toHaveLength(1);
  }
  const requests = mockInventory();
  await expect(
    Effect.runPromise(fetchClearsalvageCatalog("https://example.com/", gate)),
  ).rejects.toThrow("outside");
  for (const budget of [0, 33, 1.5])
    await expect(Effect.runPromise(invoke(undefined, budget))).rejects.toThrow(
      "budget",
    );
  expect(requests).toHaveLength(0);
});

test("Clear checks persisted clock, scope, checksum and cumulative bytes before another request", async () => {
  const requests = mockInventory();
  const expired = ClearsalvageCursor.start(
    Date.now() - CLEARSALVAGE_MAX_ELAPSED_MS - 1,
  );
  await expect(Effect.runPromise(invoke(expired))).rejects.toThrow("bound");
  expect(requests).toHaveLength(0);
  const cursor = await prefix(64);
  if (cursor.phase !== "details")
    throw new Error("Expected a saved details checkpoint");
  expect(() =>
    ClearsalvageCursorSchema.parse({
      ...cursor,
      bodyBytes: cursor.bodyBytes + 1,
    }),
  ).toThrow("integrity");
  expect(() =>
    ClearsalvageCursor.checkpoint({ ...cursor, scope: "foreign" }),
  ).toThrow();
  const capped = ClearsalvageCursor.checkpoint({
    ...cursor,
    pages: cursor.pages.map((page) => ({
      ...page,
      bodyBytes: 2 * 1024 * 1024,
    })),
    records: cursor.records.map((record, index) => ({
      ...record,
      bodyBytes: 2 * 1024 * 1024 - (index === 0 ? 1 : 0),
    })),
    bodyBytes: CLEARSALVAGE_MAX_BODY_BYTES - 1,
  });
  await expect(Effect.runPromise(invoke(capped, 1))).rejects.toThrow("exceeds");
  expect(requests).toHaveLength(65);
});

test("Clear fully closed legal checkpoint emits offline, and callback failures keep their identity", async () => {
  const requests = mockInventory();
  const cursor = await prefix(185);
  if (cursor.phase !== "closing")
    throw new Error("Expected a saved closing checkpoint");
  const closingBytes = clearsalvageSaved.closing.reduce(
    (sum, page) => sum + Buffer.byteLength(page.raw),
    0,
  );
  const closed = ClearsalvageCursor.checkpoint({
    ...cursor,
    closing: cursor.pages.length,
    closingBodyBytes: closingBytes,
    bodyBytes: cursor.bodyBytes + closingBytes,
  });
  const failure = { _tag: "SinkRejected", operation: "test" };
  const failed = await Effect.runPromise(
    Effect.either(invoke(closed, 1, () => Effect.fail(failure))),
  );
  expect(failed._tag).toBe("Left");
  if (failed._tag === "Left") expect(failed.left).toBe(failure);
  let batchCalls = 0;
  const yardFailed = await Effect.runPromise(
    Effect.either(
      streamClearsalvageInventoryWithRequestGate(
        {
          startCursor: closed,
          onYards: () => Effect.fail(failure),
          onBatch: () =>
            Effect.sync(() => {
              batchCalls++;
            }),
        },
        gate,
      ),
    ),
  );
  expect(yardFailed._tag).toBe("Left");
  if (yardFailed._tag === "Left") expect(yardFailed.left).toBe(failure);
  expect(batchCalls).toBe(0);
  const result = await Effect.runPromise(invoke(closed, 1));
  expect(result.status).toBe("complete");
  expect(result.count).toBe(177);
  expect(result.pagesProcessed).toBe(0);
  expect(requests).toHaveLength(185);
});

const GMC6 = "https://clearsalvage.com/inventory/gmc-6/";
const settle = (result: { cursor: ClearsalvageCursor }) =>
  ClearsalvageCursor.parse(ClearsalvageCursor.serialize(result.cursor));
/** Stand in for the durable Workflow sleep reaching the persisted retryAt. */
function elapseCooldown(cursor: ClearsalvageCursor) {
  if (cursor.phase !== "details" || cursor.retryAt === undefined)
    throw new Error("Expected a details checkpoint waiting on a cooldown");
  return ClearsalvageCursor.checkpoint({ ...cursor, retryAt: Date.now() - 1 });
}

test("Clear host 403 on a published donor pauses at a durable cooldown and resumes that donor", async () => {
  const requests = mockInventory({ blocked: { url: GMC6, times: 1 } });
  // Two catalog pages and the 158 donors before gmc-6 were accepted in prod.
  let cursor = await prefix(160);
  const before = Date.now();
  const blocked = await Effect.runPromise(invoke(cursor, 8));
  expect(blocked.status).toBe("paused");
  expect(blocked.pagesProcessed).toBe(1);
  expect(blocked.observedVins).toEqual([]);
  expect(blocked.warnings.join(" ")).toContain("HTTP 403");
  expect(requests).toHaveLength(161);
  expect(requests.at(-1)).toBe(GMC6);
  cursor = settle(blocked);
  if (cursor.phase !== "details")
    throw new Error(
      "Expected the blocked donor to keep its details checkpoint",
    );
  expect(cursor.records).toHaveLength(158);
  expect(cursor.hostBlocks).toBe(1);
  expect(cursor.retryAt).toBeGreaterThanOrEqual(before + 2 * 60_000);

  const early = await Effect.runPromise(invoke(cursor));
  expect(early.status).toBe("paused");
  expect(early.pagesProcessed).toBe(0);
  expect(requests).toHaveLength(161);

  cursor = elapseCooldown(cursor);
  const vehicles: ClearsalvageCanonicalVehicle[] = [];
  while (cursor.phase !== "complete") {
    const result = await Effect.runPromise(
      invoke(cursor, 32, (batch) =>
        Effect.sync(() => {
          vehicles.push(...batch);
        }),
      ),
    );
    expect(result.pagesProcessed).toBeGreaterThan(0);
    cursor = settle(result);
  }
  expect(vehicles).toHaveLength(177);
  expect(vehicles.some((vehicle) => vehicle.vin === "1GKDT13S762267617")).toBe(
    true,
  );
  expect(requests).toHaveLength(188);
  expect(requests.filter((url) => url === GMC6)).toHaveLength(2);
});

test("Clear repeated host blocks exhaust three cooldowns and reject before every callback", async () => {
  const requests = mockInventory({
    blocked: { url: GMC6, times: Number.POSITIVE_INFINITY },
  });
  let cursor = await prefix(160);
  let callbacks = 0;
  const onBatch = () =>
    Effect.sync(() => {
      callbacks++;
    });
  for (let block = 1; block <= 3; block++) {
    const result = await Effect.runPromise(invoke(cursor, 8, onBatch));
    expect(result.status).toBe("paused");
    cursor = settle(result);
    if (cursor.phase !== "details")
      throw new Error("Expected a details cooldown checkpoint");
    expect(cursor.hostBlocks).toBe(block);
    cursor = elapseCooldown(cursor);
  }
  await expect(Effect.runPromise(invoke(cursor, 8, onBatch))).rejects.toThrow(
    "Prior inventory is preserved",
  );
  expect(callbacks).toBe(0);
  expect(requests.filter((url) => url === GMC6)).toHaveLength(4);
});

test("Clear host block whose Retry-After outlasts the census hour rejects without waiting", async () => {
  const requests = mockInventory({
    blocked: { url: GMC6, times: 1, retryAfter: "7200" },
  });
  const cursor = await prefix(160);
  await expect(Effect.runPromise(invoke(cursor, 8))).rejects.toThrow(
    "Prior inventory is preserved",
  );
  expect(requests).toHaveLength(161);
});
