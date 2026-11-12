import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { soakRustyhookInventory } from "../../../scripts/soak-rustyhook";
import { streamRustyhookInventoryWithRequestGate } from "./rustyhook-connector";
import {
  RUSTYHOOK_MAX_CURSOR_BYTES,
  RustyhookCursor,
  RustyhookCursorSchema,
} from "./rustyhook-cursor";
import type { RustyhookCanonicalVehicle } from "./rustyhook-transform";
import {
  rustyhookTestCatalog,
  rustyhookTestDetail,
  rustyhookTestPosts,
} from "./rustyhook-test-fixtures";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
function mockInventory(
  options: {
    rejects?: number;
    duplicateVin?: boolean;
    drift?: boolean;
    init?: ResponseInit;
    network?: boolean;
    wrongUrl?: boolean;
  } = {},
) {
  const requests: { url: string; redirect: RequestRedirect | undefined }[] = [];
  const catalogReads = new Map<number, number>();
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push({ url: url.href, redirect: init?.redirect });
      if (options.network) throw new TypeError("Network unavailable");
      let body: string;
      if (url.searchParams.get("E") !== "Detail") {
        const page = Number(url.searchParams.get("SPage") ?? "0") + 1;
        const reads = (catalogReads.get(page) ?? 0) + 1;
        catalogReads.set(page, reads);
        body = rustyhookTestCatalog(page);
        if (options.drift && page === 2 && reads > 1)
          body = body.replaceAll("2011 Jaguar XFR", "2012 Jaguar XFR");
      } else {
        const index = rustyhookTestPosts.findIndex(
          (post) => post.url === url.href,
        );
        if (index < 0) throw new Error("Unexpected donor URL");
        const fields: Record<string, string> = {};
        if (index >= 26 - (options.rejects ?? 1)) {
          fields.VIN = "2GNFLGE35F622462x";
          fields["Car Notes"] = "2GNFLGE35F6224627 Actual Vin";
          // Keep distinct rejected identities when testing the rejection ceiling.
          if (index < 25) {
            fields.VIN = "SAJWA0JC6BM" + String(200000 + index);
            fields["Car Notes"] =
              "SAJWA0JC6BM" + String(300000 + index) + " Actual Vin";
          }
        }
        if (options.duplicateVin && index === 1)
          fields.VIN = "SAJWA0JC6BM100000";
        body = rustyhookTestDetail(index, fields);
      }
      const response = new Response(
        body,
        options.init ?? {
          headers: { "content-type": "text/html; charset=UTF-8" },
        },
      );
      if (options.wrongUrl)
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
  cursor: RustyhookCursor = RustyhookCursor.initial,
  maxPages = 3,
  onBatch: (
    vehicles: RustyhookCanonicalVehicle[],
  ) => Effect.Effect<void, Error> = () => Effect.void,
) =>
  Effect.runPromise(
    streamRustyhookInventoryWithRequestGate(
      { startCursor: cursor, maxPages, onBatch },
      gate,
    ),
  );

test("Rusty Hook completes all 32 controls and emits only after every closing page, across wire round trips", async () => {
  const requests = mockInventory();
  const batches: RustyhookCanonicalVehicle[][] = [];
  const result = await soakRustyhookInventory(async (cursor, maxPages) => {
    const before = RustyhookCursor.serialize(cursor);
    const chunk = await run(cursor, maxPages, (vehicles) =>
      Effect.sync(() => {
        batches.push(vehicles);
      }),
    );
    expect(RustyhookCursor.serialize(cursor)).toBe(before);
    expect(RustyhookCursorSchema.safeParse(chunk.cursor).success).toBe(true);
    if (chunk.status === "paused") {
      expect(chunk.count).toBe(0);
      expect(batches).toHaveLength(0);
    }
    return chunk;
  });
  expect(result).toMatchObject({
    status: "complete",
    count: 25,
    pagesProcessed: 32,
    accounting: {
      recordsProcessed: 26,
      recordsRejected: 1,
      duplicateVehicles: 0,
    },
  });
  expect(result.observedVins).toEqual([
    "2GNFLGE35F6224627",
    "2GNFLGE35F622462X",
  ]);
  expect(batches).toHaveLength(1);
  expect(batches[0]).toHaveLength(25);
  expect(requests).toHaveLength(32);
  expect(requests.every((request) => request.redirect === "manual")).toBe(true);
  expect(
    requests.filter((request) => request.url.includes("E=Detail")),
  ).toHaveLength(26);
  expect(
    Buffer.byteLength(RustyhookCursor.serialize(result.cursor)),
  ).toBeLessThan(RUSTYHOOK_MAX_CURSOR_BYTES);
  expect(
    await run(result.cursor, 3, () => Effect.die("Terminal replay emitted")),
  ).toMatchObject({ count: 0, pagesProcessed: 0 });
  expect(requests).toHaveLength(32);
});

test("Rusty Hook closes middle-page drift and excessive counted rejects without callbacks", async () => {
  for (const options of [{ drift: true }, { rejects: 3 }]) {
    mockInventory(options);
    await expect(
      soakRustyhookInventory((cursor, maxPages) =>
        run(cursor, maxPages, () => Effect.die("Unvalidated callback")),
      ),
    ).rejects.toThrow(
      options.drift ? "closing listing membership" : "10% limit",
    );
  }
});
test("Rusty Hook rejects a duplicate genuine identity before terminal emission", async () => {
  mockInventory({ duplicateVin: true });
  await expect(
    soakRustyhookInventory((cursor, maxPages) => run(cursor, maxPages)),
  ).rejects.toThrow("reuse a native VIN");
});
test.each<ResponseInit>([
  { status: 403, headers: { "content-type": "text/html" } },
  {
    status: 302,
    headers: { "content-type": "text/html", location: "https://example.com" },
  },
  { status: 206, headers: { "content-type": "text/html" } },
  { headers: { "content-type": "application/json" } },
  {
    headers: { "content-type": "text/html", "content-range": "bytes 0-10/100" },
  },
  { headers: { "content-type": "text/html", "content-length": "1" } },
])(
  "Rusty Hook fails complete-response guards without retry (%#)",
  async (init) => {
    const requests = mockInventory({ init });
    await expect(run()).rejects.toThrow("previous inventory is preserved");
    expect(requests).toHaveLength(1);
  },
);
test("Rusty Hook does not retry network failure or a changed final URL", async () => {
  for (const options of [{ network: true }, { wrongUrl: true }]) {
    const requests = mockInventory(options);
    await expect(run()).rejects.toThrow("previous inventory is preserved");
    expect(requests).toHaveLength(1);
  }
});
test("Rusty Hook callback failures leave the supplied closing checkpoint intact", async () => {
  mockInventory();
  let cursor: RustyhookCursor = RustyhookCursor.initial;
  while (cursor.phase !== "closing" || cursor.closing.length < 2)
    cursor = (await run(cursor, 1)).cursor;
  const before = RustyhookCursor.serialize(cursor);
  await expect(
    run(cursor, 1, () => Effect.fail(new Error("Callback unavailable"))),
  ).rejects.toThrow("Callback unavailable");
  expect(RustyhookCursor.serialize(cursor)).toBe(before);
});
test("Rusty Hook rejects corrupt native records, forged terminal cursors and oversized wire before HTTP", async () => {
  const requests = mockInventory();
  const partial = await run();
  const wire = RustyhookCursor.serialize(partial.cursor);
  const invalid: unknown = JSON.parse(wire.replace("Jaguar", "Toyota"));
  expect(RustyhookCursorSchema.safeParse(invalid).success).toBe(false);
  expect(() =>
    RustyhookCursor.parse(wire.replace("Jaguar", "Toyota")),
  ).toThrow();
  expect(() =>
    RustyhookCursor.parse(" ".repeat(RUSTYHOOK_MAX_CURSOR_BYTES + 1)),
  ).toThrow("exceeds 1 MiB");
  expect(
    RustyhookCursorSchema.safeParse({ source: "rustyhook", phase: "complete" })
      .success,
  ).toBe(false);
  const count = requests.length;
  await expect(run(undefined, 0)).rejects.toThrow("request-unit budget");
  await expect(run(undefined, 4)).rejects.toThrow("request-unit budget");
  expect(requests).toHaveLength(count);
});

test("Rusty Hook reconstructs cursor ancestry and optional bindings even with a recomputed checksum", async () => {
  mockInventory();
  const listing = await run();
  expect(() =>
    RustyhookCursor.checkpoint({
      ...listing.cursor,
      pages: [...listing.cursor.pages].reverse(),
    }),
  ).toThrow("listing prefix");
  expect(() =>
    RustyhookCursor.checkpoint({ ...listing.cursor, phase: "complete" }),
  ).toThrow("control prefix");
  const detail = await run(listing.cursor, 1);
  expect(() =>
    RustyhookCursor.checkpoint({
      ...detail.cursor,
      records: detail.cursor.records.map((record) => ({
        ...record,
        images: ["https://example.com/foreign.jpg"],
      })),
    }),
  ).toThrow("image binding");
});
