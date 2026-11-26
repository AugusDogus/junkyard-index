import { afterEach, expect, spyOn, test } from "bun:test";
import {
  isDurableSourceCursorTerminal,
  serializeDurableSourceCursor,
} from "./durable-source";
import { Effect, Logger } from "effect";
import type { ProviderRequestGate } from "~/server/ingestion/provider-http-client";
import { WeberbrothersCursor } from "./weberbrothers-cursor";
import { streamWeberbrothersInventoryWithRequestGate as stream } from "./weberbrothers-connector";
import { fetchWeberbrothersPage } from "./weberbrothers-client";
import {
  ProviderChunkClock,
  ProviderNotReadyDeferred,
} from "./provider-chunk-clock";
import {
  weberbrothersFixturePost as post,
  weberbrothersFixtureRoot as root,
  weberbrothersFixtureListing as listing,
  weberbrothersFixtureDetail as detail,
} from "./weberbrothers-test-fixtures";

const gate: ProviderRequestGate = (request) => request;
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
/** A body served with the default status, a body with its own status, or a
 * network failure thrown by fetch. */
type MockReply = string | { body: string; status: number } | Error;
function mockSource(bodies: MockReply[], status = 200) {
  const urls: string[] = [];
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL) => {
        urls.push(String(input));
        const reply = bodies.shift();
        if (reply === undefined) throw new Error("Unexpected test request");
        if (reply instanceof Error) throw reply;
        const served =
          typeof reply === "string" ? { body: reply, status } : reply;
        return new Response(served.body, {
          status: served.status,
          headers: { "content-type": "text/html" },
        });
      },
      { preconnect: originalFetch.preconnect },
    ),
  );
  return urls;
}
const limits = { minimumUniqueInventory: 1, previousUniqueInventory: null };
test("resumes each phase without repeating opening or emitting partial inventory", async () => {
  const urls = mockSource([listing(), detail(), listing()]);
  let batches = 0,
    yards = 0;
  const onBatch = () =>
    Effect.sync(() => {
      batches++;
    });
  const onYards = () =>
    Effect.sync(() => {
      yards++;
    });
  const opening = await Effect.runPromise(
    stream({ ...limits, maxPages: 1, onBatch, onYards }, gate),
  );
  expect(opening.status).toBe("paused");
  expect(opening.cursor.phase).toBe("details");
  expect(opening.accounting.recordsProcessed).toBe(0);
  expect(batches).toBe(0);
  const donor = await Effect.runPromise(
    stream(
      {
        ...limits,
        maxPages: 1,
        onBatch,
        onYards,
        startCursor: WeberbrothersCursor.parse(
          WeberbrothersCursor.serialize(opening.cursor),
        ),
      },
      gate,
    ),
  );
  expect(donor.cursor.phase).toBe("closing");
  expect(batches).toBe(0);
  const complete = await Effect.runPromise(
    stream(
      {
        ...limits,
        maxPages: 1,
        onBatch,
        onYards,
        startCursor: WeberbrothersCursor.parse(
          WeberbrothersCursor.serialize(donor.cursor),
        ),
      },
      gate,
    ),
  );
  expect(complete.status).toBe("complete");
  expect(complete.count).toBe(1);
  expect(
    isDurableSourceCursorTerminal(
      "weberbrothers",
      serializeDurableSourceCursor(complete.cursor),
    ),
  ).toBe(true);
  expect(complete.accounting).toEqual({
    recordsProcessed: 1,
    recordsExcluded: 0,
    recordsRejected: 0,
    duplicateVehicles: 0,
  });
  expect(batches).toBe(1);
  expect(yards).toBe(1);
  expect(urls).toEqual([root, post.url, root]);
  const resumed = await Effect.runPromise(
    stream({ ...limits, onBatch, onYards, startCursor: complete.cursor }, gate),
  );
  expect(resumed.status).toBe("complete");
  expect(resumed.count).toBe(0);
  expect(batches).toBe(1);
  expect(urls).toHaveLength(3);
});
test("changed closing membership blocks callbacks and reconciliation", async () => {
  const urls = mockSource([
    listing(),
    detail(),
    listing([{ ...post, title: "2024 NISSAN MURANO SV" }]),
  ]);
  let batches = 0;
  await expect(
    Effect.runPromise(
      stream(
        {
          ...limits,
          maxPages: 3,
          onBatch: () =>
            Effect.sync(() => {
              batches++;
            }),
        },
        gate,
      ),
    ),
  ).rejects.toThrow("closing membership");
  expect(batches).toBe(0);
  expect(urls).toHaveLength(3);
});
test("failed callbacks return no advanced checkpoint", async () => {
  mockSource([listing(), detail(), listing()]);
  await expect(
    Effect.runPromise(
      stream(
        {
          ...limits,
          maxPages: 3,
          onBatch: () => Effect.fail(new Error("real callback failure")),
        },
        gate,
      ),
    ),
  ).rejects.toThrow("real callback failure");
  expect(WeberbrothersCursor.initial.phase).toBe("catalog");
});
test("required rejection and prior-run guards block terminal emission", async () => {
  mockSource([listing(), detail(), listing()]);
  let batches = 0;
  await expect(
    Effect.runPromise(
      stream(
        {
          ...limits,
          previousUniqueInventory: 4,
          maxPages: 3,
          onBatch: () =>
            Effect.sync(() => {
              batches++;
            }),
        },
        gate,
      ),
    ),
  ).rejects.toThrow("50%");
  expect(batches).toBe(0);
});
test("exact 10% required rejection retains independent VIN presence at terminal completion", async () => {
  const posts = Array.from({ length: 10 }, (_, index) => ({
    ...post,
    url: post.url.replace("/product/", "/product/test-" + index + "-"),
    nativePostId: String(1908003 + index),
    stock: "TEST" + index,
    title: index === 9 ? "20225 NISSAN MURANO SV" : post.title,
  }));
  mockSource([
    listing(posts),
    ...posts.map((item, index) =>
      detail(item, { vin: "5N1AZ3BS4SC11124" + index }),
    ),
    listing(posts),
  ]);
  const complete = await Effect.runPromise(
    stream({ ...limits, maxPages: 20, onBatch: () => Effect.void }, gate),
  );
  expect(complete.status).toBe("complete");
  expect(complete.count).toBe(9);
  expect(complete.accounting.recordsRejected).toBe(1);
  expect(complete.observedVins).toEqual(["5N1AZ3BS4SC111249"]);
});
test("corrupted, reordered and forged-phase checkpoints fail before HTTP", async () => {
  const urls = mockSource([listing()]);
  const opening = await Effect.runPromise(
    stream({ ...limits, maxPages: 1, onBatch: () => Effect.void }, gate),
  );
  const serialized = WeberbrothersCursor.serialize(opening.cursor);
  expect(() =>
    WeberbrothersCursor.parse(
      serialized.replace('"phase":"details"', '"phase":"complete"'),
    ),
  ).toThrow("checksum");
  expect(() =>
    WeberbrothersCursor.checkpoint({ ...opening.cursor, phase: "complete" }),
  ).toThrow("contiguous");
  expect(() =>
    WeberbrothersCursor.checkpoint({
      ...opening.cursor,
      pages: [...opening.cursor.pages, ...opening.cursor.pages],
    }),
  ).toThrow();
  expect(() => WeberbrothersCursor.parse("[]")).toThrow("object");
  expect(urls).toHaveLength(1);
});
test("denied public reads and uncertain requests are not retried", async () => {
  const urls = mockSource(["Access denied"], 403);
  await expect(
    Effect.runPromise(fetchWeberbrothersPage(root, gate)),
  ).rejects.toThrow("403");
  expect(urls).toHaveLength(1);
  let calls = 0;
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async () => {
        calls++;
        throw new Error("network outcome unknown");
      },
      { preconnect: originalFetch.preconnect },
    ),
  );
  await expect(
    Effect.runPromise(fetchWeberbrothersPage(root, gate)),
  ).rejects.toThrow("network outcome unknown");
  expect(calls).toBe(1);
});
const donor = (index: number) => ({
  ...post,
  url: post.url.replace("/product/", "/product/test-" + index + "-"),
  nativePostId: String(1908003 + index),
  stock: "TEST" + index,
});
const firstDonor = donor(0);
const secondDonor = donor(1);
const twoPosts = [firstDonor, secondDonor];
const serverError = {
  body: "Error establishing a database connection",
  status: 500,
};
async function detailsCursor() {
  mockSource([listing(twoPosts)]);
  const opening = await Effect.runPromise(
    stream({ ...limits, maxPages: 1, onBatch: () => Effect.void }, gate),
  );
  expect(opening.cursor.phase).toBe("details");
  return opening.cursor;
}
const failureOf = (run: Promise<unknown>) =>
  run.then(
    () => null,
    (error: unknown) => error,
  );
test("a transient detail failure after progress keeps the validated checkpoint", async () => {
  const startCursor = await detailsCursor();
  const urls = mockSource([
    detail(firstDonor, { vin: "5N1AZ3BS4SC111240" }),
    serverError,
  ]);
  const logs: string[] = [];
  const paused = await Effect.runPromise(
    stream({ ...limits, startCursor, onBatch: () => Effect.void }, gate).pipe(
      Effect.provide(
        Logger.replace(
          Logger.defaultLogger,
          Logger.make(({ logLevel, message }) => {
            logs.push(`${logLevel.label} ${String(message)}`);
          }),
        ),
      ),
    ),
  );
  expect(paused.status).toBe("paused");
  expect(paused.pagesProcessed).toBe(1);
  expect(logs).toEqual([
    expect.stringMatching(
      /^WARN .*answered HTTP 500.* Returning this chunk's validated checkpoint/,
    ),
  ]);
  expect(paused.cursor.phase).toBe("details");
  expect(paused.cursor.phase === "details" && paused.cursor.records).toEqual([
    expect.objectContaining({ post: firstDonor }),
  ]);
  expect(urls).toEqual(twoPosts.map((item) => item.url));
  const resent = mockSource([
    detail(secondDonor, { vin: "5N1AZ3BS4SC111241" }),
    listing(twoPosts),
  ]);
  const complete = await Effect.runPromise(
    stream(
      {
        ...limits,
        startCursor: WeberbrothersCursor.parse(
          WeberbrothersCursor.serialize(paused.cursor),
        ),
        onBatch: () => Effect.void,
      },
      gate,
    ),
  );
  expect(complete.status).toBe("complete");
  expect(complete.count).toBe(2);
  expect(resent).toEqual([secondDonor.url, root]);
});
const fetchFailed = (code: string) =>
  new TypeError("fetch failed", {
    cause: Object.assign(new Error(code), { code }),
  });
test("a transient failure before progress defers the chunk", async () => {
  for (const reply of [
    serverError,
    { body: "Bad gateway", status: 502 },
    { body: "Unavailable", status: 503 },
    { body: "Gateway timeout", status: 504 },
    fetchFailed("ECONNRESET"),
    fetchFailed("UND_ERR_SOCKET"),
    fetchFailed("UND_ERR_HEADERS_TIMEOUT"),
  ]) {
    mockSource([reply]);
    const failure = await failureOf(
      Effect.runPromise(
        stream({ ...limits, onBatch: () => Effect.void }, gate),
      ),
    );
    expect(ProviderChunkClock.deferralOf(failure)).toBeInstanceOf(
      ProviderNotReadyDeferred,
    );
  }
});
test("unsupported statuses, DNS, TLS and refused connections fail fast", async () => {
  for (const reply of [
    { body: "Not implemented", status: 501 },
    { body: "HTTP version not supported", status: 505 },
    fetchFailed("ENOTFOUND"),
    fetchFailed("ECONNREFUSED"),
    fetchFailed("CERT_HAS_EXPIRED"),
    new TypeError("fetch failed"),
  ]) {
    mockSource([reply]);
    const failure = await failureOf(
      Effect.runPromise(
        stream({ ...limits, onBatch: () => Effect.void }, gate),
      ),
    );
    expect(failure).not.toBeNull();
    expect(ProviderChunkClock.deferralOf(failure)).toBeNull();
  }
});
test("a denied detail stays fatal after progress", async () => {
  const startCursor = await detailsCursor();
  mockSource([
    detail(firstDonor, { vin: "5N1AZ3BS4SC111240" }),
    { body: "Not found", status: 404 },
  ]);
  const failure = await failureOf(
    Effect.runPromise(
      stream({ ...limits, startCursor, onBatch: () => Effect.void }, gate),
    ),
  );
  expect(String(failure)).toContain("received 404");
  expect(ProviderChunkClock.deferralOf(failure)).toBeNull();
});
test("foreign destinations are refused before issuing requests", async () => {
  const urls = mockSource([]);
  await expect(
    Effect.runPromise(
      fetchWeberbrothersPage("https://example.com/product/vehicle/", gate),
    ),
  ).rejects.toThrow("outside");
  expect(urls).toEqual([]);
});
