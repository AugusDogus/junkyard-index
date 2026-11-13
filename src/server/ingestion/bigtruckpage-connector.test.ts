import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { streamBigtruckpageInventoryWithRequestGate } from "./bigtruckpage-connector";
import {
  BigtruckpageCursor,
  BigtruckpageCursorSchema,
} from "./bigtruckpage-cursor";
import type { BigtruckpageCanonicalVehicle } from "./bigtruckpage-transform";
import { bigtruckpageFixture } from "./bigtruckpage-test-fixtures";
import {
  BIGTRUCKPAGE_YARD,
  bigtruckpageCatalogUrl,
} from "./bigtruckpage-yard-metadata";
import { soakBigtruckpageInventory } from "../../../scripts/soak-bigtruckpage";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
async function mockInventory(
  options: {
    changedPage?: number;
    extraRejects?: number;
    duplicateVin?: boolean;
    init?: ResponseInit;
    failNetwork?: boolean;
    redirected?: boolean;
    incomplete?: boolean;
    badUtf8?: boolean;
    changedTotal?: boolean;
  } = {},
) {
  const requests: string[] = [];
  const fixtures = await Promise.all([
    bigtruckpageFixture("profile"),
    ...[1, 2, 3].map(bigtruckpageFixture),
  ]);
  const reads = new Map<string, number>();
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      requests.push(url);
      expect(init?.redirect).toBe("manual");
      if (options.failNetwork) throw new TypeError("Network unavailable");
      const number = [
        BIGTRUCKPAGE_YARD.websiteUrl,
        ...[1, 2, 3].map(bigtruckpageCatalogUrl),
      ].indexOf(url);
      let body = fixtures[number];
      if (body === undefined)
        throw new Error("Unexpected native request: " + url);
      const prior = reads.get(url) ?? 0;
      reads.set(url, prior + 1);
      if (options.changedPage === number && prior > 0)
        body = body.replace("Mileage N/A", "Changed optional mileage");
      if (options.duplicateVin && number === 2)
        body = body.replaceAll("3AKBHTDV5SDVW2004", "4V4M19EHXHN971866");
      if (options.changedTotal && number === 2)
        body = body.replace(
          "50<!-- --> donor trucks",
          "51<!-- --> donor trucks",
        );
      if (options.extraRejects && number === 2) {
        let replaced = 0;
        body = body.replace(
          /(<img\b[^>]*alt=")[^"]*/g,
          (full: string, prefix: string) => {
            if (
              replaced >= (options.extraRejects ?? 0) ||
              !/^\d{4}/.test(full.slice(prefix.length))
            )
              return full;
            replaced++;
            return prefix + "2000 Other Model";
          },
        );
      }
      const response = new Response(
        options.badUtf8 ? new Uint8Array([0xff]) : body,
        options.init ?? {
          headers: {
            "content-type": "text/html",
            ...(options.incomplete ? { "content-length": "999999" } : {}),
          },
        },
      );
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
const run = (
  cursor: BigtruckpageCursor = BigtruckpageCursor.initial,
  maxPages = 32,
  onBatch = (_batch: BigtruckpageCanonicalVehicle[]) => Effect.void,
) =>
  Effect.runPromise(
    streamBigtruckpageInventoryWithRequestGate(
      { startCursor: cursor, maxPages, onBatch },
      gate,
    ),
  );

test("native ownership precedes all pages and every opening page closes before completion", async () => {
  const requests = await mockInventory();
  const emitted: BigtruckpageCanonicalVehicle[] = [];
  const result = await run(undefined, undefined, (batch) =>
    Effect.sync(() => {
      emitted.push(...batch);
    }),
  );
  expect(result).toMatchObject({
    status: "complete",
    count: 48,
    pagesProcessed: 7,
    observedVins: ["4V4M19EHXHN971866", "1S12E9536PE549310"],
    accounting: {
      recordsProcessed: 50,
      recordsRejected: 2,
      recordsExcluded: 0,
      duplicateVehicles: 0,
    },
  });
  expect(emitted).toHaveLength(48);
  expect(requests).toEqual([
    BIGTRUCKPAGE_YARD.websiteUrl,
    ...[1, 2, 3, 1, 2, 3].map(bigtruckpageCatalogUrl),
  ]);
});

test("two-unit durable chunks serialize and resume with exact accounting and rejected VIN preservation", async () => {
  const requests = await mockInventory();
  let cursor: BigtruckpageCursor = BigtruckpageCursor.initial;
  let count = 0;
  const observed: string[] = [];
  for (let chunks = 0; chunks < 4; chunks++) {
    const chunk = await run(cursor, 2);
    count += chunk.count;
    observed.push(...chunk.observedVins);
    const serialized: unknown = JSON.parse(JSON.stringify(chunk.cursor));
    cursor = BigtruckpageCursorSchema.parse(serialized);
  }
  expect(cursor.phase).toBe("complete");
  expect(count).toBe(48);
  expect(observed).toEqual(["4V4M19EHXHN971866", "1S12E9536PE549310"]);
  expect(requests).toHaveLength(7);
});

test.each([1, 2, 3])(
  "changing closing page %i prevents completion",
  async (changedPage) => {
    await mockInventory({ changedPage });
    await expect(run()).rejects.toThrow("changed during traversal");
  },
);

test("the 10% boundary stays unchanged and inconsistent totals or duplicate rejected VINs fail", async () => {
  await mockInventory({ extraRejects: 3 });
  expect((await run()).count).toBe(45);
  await mockInventory({ extraRejects: 4 });
  await expect(run()).rejects.toThrow("10% required-field rejection limit");
  await mockInventory({ duplicateVin: true });
  await expect(run()).rejects.toThrow("unique donor identities");
  await mockInventory({ changedTotal: true });
  await expect(run()).rejects.toThrow("contiguous totals");
});

test.each<ResponseInit>([
  { status: 403, headers: { "content-type": "text/html" } },
  { status: 206, headers: { "content-type": "text/html" } },
  {
    status: 302,
    headers: { "content-type": "text/html", location: "https://example.com" },
  },
  { headers: { "content-type": "application/json" } },
  {
    headers: {
      "content-type": "text/html",
      "content-range": "bytes 0-100/1000",
    },
  },
])(
  "HTTP boundary rejects incomplete or wrong inventory responses without retries",
  async (init) => {
    const requests = await mockInventory({ init });
    await expect(run()).rejects.toThrow("previous inventory is preserved");
    expect(requests).toHaveLength(1);
  },
);
test.each(["failNetwork", "redirected", "incomplete", "badUtf8"] as const)(
  "%s does not advance or retry",
  async (failure) => {
    const requests = await mockInventory({ [failure]: true });
    await expect(run()).rejects.toThrow("previous inventory is preserved");
    expect(requests).toHaveLength(1);
  },
);

test("invalid durable state fails before I/O, and the soak validates serialized checkpoints", async () => {
  const requests = await mockInventory();
  expect(
    BigtruckpageCursorSchema.safeParse({
      source: "bigtruckpage",
      version: 1,
      phase: "catalog",
      pages: [],
    }).success,
  ).toBe(false);
  await expect(run(undefined, 0)).rejects.toThrow(
    "validated BigTruckPage cursor",
  );
  expect(requests).toHaveLength(0);
  const summary = await soakBigtruckpageInventory(
    (cursor) => run(cursor, 2),
    10,
  );
  expect(summary).toMatchObject({
    count: 48,
    pagesProcessed: 7,
    status: "complete",
    accounting: { recordsProcessed: 50, recordsRejected: 2 },
  });
  expect(summary.observedVins).toHaveLength(2);
});
