import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { streamImportapartInventoryWithRequestGate } from "./importapart-connector";
import {
  ImportapartCursor,
  ImportapartCursorSchema,
} from "./importapart-cursor";
import type { ImportapartCanonicalVehicle } from "./importapart-transform";
import {
  importapartTestDetail,
  importapartTestListing,
  importapartTestPost,
} from "./importapart-test-fixtures";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
function mockInventory(
  options: {
    duplicateVin?: boolean;
    rejectFirst?: boolean;
    rejected?: number;
    changedBookend?: boolean;
    init?: ResponseInit;
    failNetwork?: boolean;
    redirected?: boolean;
  } = {},
) {
  const requests: string[] = [];
  const posts = Array.from({ length: 10 }, (_, index) => ({
    ...importapartTestPost,
    url: importapartTestPost.url + "-" + index,
  }));
  let catalogReads = 0;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push(url.href);
      if (options.failNetwork) throw new TypeError("Network unavailable");
      let body: string;
      if (url.pathname === "/blogs/part-outs") {
        catalogReads++;
        body = importapartTestListing(1, posts);
        if (options.changedBookend && catalogReads > 1)
          body = importapartTestListing(1, posts.slice(1));
      } else {
        const index = posts.findIndex((post) => post.url === url.href);
        if (index < 0) throw new Error("Unexpected native donor URL");
        body = importapartTestDetail({
          vin:
            "JM1NB353710" + String(207894 + (options.duplicateVin ? 0 : index)),
          header:
            (options.rejectFirst && index === 0) ||
            index >= 10 - (options.rejected ?? 0)
              ? "2000 Mazda Miata - PART OUT"
              : undefined,
        });
      }
      const response = new Response(
        body,
        options.init ?? { headers: { "content-type": "text/html" } },
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
  cursor: ImportapartCursor = ImportapartCursor.initial,
  maxPages = 32,
  onBatch = (_batch: ImportapartCanonicalVehicle[]) => Effect.void,
) =>
  Effect.runPromise(
    streamImportapartInventoryWithRequestGate(
      { startCursor: cursor, maxPages, onBatch },
      gate,
    ),
  );

test("Importapart enumerates, emits and validates both bookends without photo requests", async () => {
  const requests = mockInventory();
  const result = await run();
  expect(result).toMatchObject({
    status: "complete",
    count: 10,
    pagesProcessed: 13,
    accounting: {
      recordsProcessed: 10,
      recordsRejected: 0,
      duplicateVehicles: 0,
    },
  });
  expect(requests).toHaveLength(13);
  expect(
    requests.every((url) =>
      url.startsWith("https://importapart.com/blogs/part-outs"),
    ),
  ).toBe(true);
});
test("Importapart pauses and resumes without rereading accepted donor details", async () => {
  const requests = mockInventory({ rejected: 1 });
  let cursor: ImportapartCursor = ImportapartCursor.initial;
  let count = 0;
  const observed: string[] = [];
  for (let chunks = 0; chunks < 20; chunks++) {
    const chunk = await run(cursor, 2);
    count += chunk.count;
    observed.push(...chunk.observedVins);
    expect(ImportapartCursorSchema.safeParse(chunk.cursor).success).toBe(true);
    cursor = chunk.cursor;
    if (chunk.status === "complete") break;
  }
  expect(cursor.phase).toBe("complete");
  expect(count).toBe(9);
  expect(observed).toEqual(["JM1NB353710207903"]);
  expect(requests).toHaveLength(13);
});
test("Importapart rejects duplicate native VINs including previously rejected presence", async () => {
  mockInventory({ duplicateVin: true, rejectFirst: true });
  await expect(run()).rejects.toThrow("reuse a valid VIN");
});
test("Importapart rejects required-field loss above 10% and changing bookends", async () => {
  mockInventory({ rejected: 2 });
  await expect(run()).rejects.toThrow("10% limit");
  mockInventory({ changedBookend: true });
  await expect(run()).rejects.toThrow("changed during traversal");
});
test.each<ResponseInit>([
  { status: 403, headers: { "content-type": "text/html" } },
  { status: 206, headers: { "content-type": "text/html" } },
  { headers: { "content-type": "application/json" } },
  {
    headers: { "content-type": "text/html", "content-range": "bytes 0-10/100" },
  },
  { headers: { "content-type": "text/html", "content-length": "1" } },
])(
  "Importapart rejects partial and non-HTML responses with no retry (%#)",
  async (init) => {
    const requests = mockInventory({ init });
    await expect(run()).rejects.toThrow("previous inventory is preserved");
    expect(requests).toHaveLength(1);
  },
);
test("Importapart does not retry network failure or redirects", async () => {
  for (const options of [{ failNetwork: true }, { redirected: true }]) {
    const requests = mockInventory(options);
    await expect(run()).rejects.toThrow("previous inventory is preserved");
    expect(requests).toHaveLength(1);
  }
});
test("Importapart rejects invalid request budgets before HTTP and terminal replay is idle", async () => {
  const requests = mockInventory();
  await expect(run(undefined, 0)).rejects.toThrow(
    "validated Importapart cursor",
  );
  const result = await run({
    source: "importapart",
    version: 1,
    phase: "complete",
  });
  expect(result.pagesProcessed).toBe(0);
  expect(requests).toEqual([]);
});
test("Importapart validates cursor scope, record accounting and page continuity", async () => {
  mockInventory();
  const partial = await run(undefined, 2);
  expect(partial.cursor.phase).toBe("details");
  if (partial.cursor.phase !== "details")
    throw new Error("Expected detail checkpoint");
  const cursor = partial.cursor;
  expect(
    ImportapartCursorSchema.safeParse({ ...cursor, pages: [] }).success,
  ).toBe(false);
  expect(
    ImportapartCursorSchema.safeParse({
      ...cursor,
      pages: cursor.pages.map((page) => ({ ...page, page: 2 })),
    }).success,
  ).toBe(false);
  expect(
    ImportapartCursorSchema.safeParse({
      ...cursor,
      records: [...cursor.records, ...cursor.records],
    }).success,
  ).toBe(false);
  expect(
    ImportapartCursorSchema.safeParse({
      ...cursor,
      records: cursor.records.map((record) => ({
        ...record,
        post: { ...record.post, url: "https://example.com/donor" },
      })),
    }).success,
  ).toBe(false);
});
