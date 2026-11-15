import { afterEach, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import type { ProviderRequestGate } from "~/server/ingestion/provider-http-client";
import { WeberbrothersCursor } from "./weberbrothers-cursor";
import { streamWeberbrothersInventoryWithRequestGate as stream } from "./weberbrothers-connector";
import { fetchWeberbrothersPage } from "./weberbrothers-client";
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
function mockSource(bodies: string[], status = 200) {
  const urls: string[] = [];
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL) => {
        urls.push(String(input));
        const body = bodies.shift();
        if (body === undefined) throw new Error("Unexpected test request");
        return new Response(body, {
          status,
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
test("foreign destinations are refused before issuing requests", async () => {
  const urls = mockSource([]);
  await expect(
    Effect.runPromise(
      fetchWeberbrothersPage("https://example.com/product/vehicle/", gate),
    ),
  ).rejects.toThrow("outside");
  expect(urls).toEqual([]);
});
