import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { connectorChunkMetrics } from "./connector-chunk";
import { streamPickapartvaInventoryWithRequestGate } from "./pickapartva-connector";
import {
  PickapartvaCursorSchema,
  type PickapartvaCursor,
} from "./pickapartva-cursor";
import type { PickapartvaCanonicalVehicle } from "./pickapartva-transform";
import {
  pickapartvaTestPage,
  pickapartvaTestRecord,
  pickapartvaTestRecords,
} from "./pickapartva-test-fixtures";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
function mockPages(
  options: {
    pages?: string[];
    rewrite?: (body: string, page: number, call: number) => string;
    response?: (body: string) => Response;
  } = {},
) {
  const pages = options.pages ?? [
    pickapartvaTestPage(pickapartvaTestRecords(10)),
  ];
  const calls: string[] = [];
  const occurrences = new Map<number, number>();
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(url.origin).toBe("https://pickapartva.com");
      expect(init?.redirect).toBe("manual");
      const page = Number(url.searchParams.get("pagenum"));
      const call = (occurrences.get(page) ?? 0) + 1;
      occurrences.set(page, call);
      calls.push(url.href);
      const body = pages[page - 1];
      if (body === undefined)
        throw new Error("Unexpected unpublished page request");
      const changed = options.rewrite?.(body, page, call) ?? body;
      return (
        options.response?.(changed) ??
        new Response(changed, { headers: { "content-type": "text/html" } })
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  return calls;
}
const run = (
  onBatch = (_batch: PickapartvaCanonicalVehicle[]) => Effect.void,
  startCursor?: PickapartvaCursor,
  maxPages = 15,
) =>
  Effect.runPromise(
    streamPickapartvaInventoryWithRequestGate(
      { onBatch, startCursor, maxPages },
      gate,
    ),
  );

test("Pick-A-Part VA closes the global snapshot before callbacks and completes idempotently", async () => {
  const calls = mockPages();
  const result = await run((batch) =>
    Effect.sync(() => {
      expect(calls.length).toBe(2);
      expect(batch).toHaveLength(10);
    }),
  );
  expect(result).toMatchObject({
    status: "complete",
    count: 10,
    pagesProcessed: 1,
    cursor: { source: "pickapartva", phase: "complete" },
  });
  expect(connectorChunkMetrics(result, result.count)).toEqual({
    vehiclesProcessed: 10,
    uniqueVehicles: 10,
    duplicateVehicles: 0,
    rejectedVehicles: 0,
  });
  const before = calls.length;
  const complete = await run(
    () => Effect.die("Complete replay must not emit"),
    result.cursor,
  );
  expect(calls.length).toBe(before);
  expect(complete.count).toBe(0);
  expect(complete.pagesProcessed).toBe(0);
});

test("Pick-A-Part VA callbacks may consume batch arrays without changing counts", async () => {
  mockPages();
  let received = 0;
  const result = await run((batch) =>
    Effect.sync(() => {
      received += batch.length;
      batch.splice(0);
    }),
  );
  expect(received).toBe(10);
  expect(result.count).toBe(10);
  expect(connectorChunkMetrics(result, received).duplicateVehicles).toBe(0);
});

test("Pick-A-Part VA resumes serialized emission partitions without prefix re-emission or arbitrary optional survivors", async () => {
  const first = pickapartvaTestRecords();
  const changedDuplicate = {
    ...pickapartvaTestRecord,
    cardId: "PAP999999",
    stock: "PAP999999",
    row: "999",
    setDate: "2026-11-11",
  };
  const pages = [
    pickapartvaTestPage(first, 1, 2),
    pickapartvaTestPage(
      [changedDuplicate, ...pickapartvaTestRecords(1, 1000)],
      2,
      2,
    ),
  ];
  const calls = mockPages({ pages });
  const emitted: PickapartvaCanonicalVehicle[] = [];
  const one = await run(
    (batch) => Effect.sync(() => emitted.push(...batch)).pipe(Effect.asVoid),
    undefined,
    1,
  );
  expect(one.status).toBe("paused");
  expect(one.count).toBe(500);
  expect(calls).toHaveLength(4);
  expect(
    emitted.find((vehicle) => vehicle.vin === pickapartvaTestRecord.vin),
  ).toMatchObject({
    stockNumber: null,
    row: null,
    availableDate: null,
    detailsUrl: "https://pickapartva.com/inventory/ANY/ANY/?k=1&id=ANY",
  });
  const cursor = PickapartvaCursorSchema.parse(
    JSON.parse(JSON.stringify(one.cursor)),
  );
  const two = await run(
    (batch) => Effect.sync(() => emitted.push(...batch)).pipe(Effect.asVoid),
    cursor,
    1,
  );
  expect(two).toMatchObject({
    status: "complete",
    count: 1,
    pagesProcessed: 1,
    accounting: {
      recordsProcessed: 2,
      recordsRejected: 0,
      duplicateVehicles: 1,
    },
  });
  expect(emitted).toHaveLength(501);
  expect(new Set(emitted.map((vehicle) => vehicle.vin)).size).toBe(501);
  expect(connectorChunkMetrics(two, two.count).duplicateVehicles).toBe(1);
});

test("Pick-A-Part VA preserves independently valid rejected identities even outside the emitted prefix", async () => {
  const records = pickapartvaTestRecords(20);
  const changed = records.map((record, index) =>
    index === 0 ? { ...record, model: "Unknown" } : record,
  );
  mockPages({ pages: [pickapartvaTestPage(changed)] });
  const result = await run();
  expect(result).toMatchObject({
    count: 19,
    observedVins: [pickapartvaTestRecord.vin],
    accounting: {
      recordsProcessed: 20,
      recordsRejected: 1,
      duplicateVehicles: 0,
    },
  });
});

test.each(["closing", "required conflict", "yard quality"])(
  "Pick-A-Part VA blocks %s before callbacks",
  async (kind) => {
    const rows = pickapartvaTestRecords(10);
    if (kind === "required conflict")
      rows.push({
        ...pickapartvaTestRecord,
        cardId: "PAP999999",
        stock: "PAP999999",
        year: "2009",
      });
    if (kind === "yard quality")
      rows[0] = { ...pickapartvaTestRecord, model: "Unknown" };
    mockPages({
      pages: [pickapartvaTestPage(rows)],
      rewrite: (body, _page, call) =>
        kind === "closing" && call > 1
          ? body.replace("2026-11-10", "2026-11-11")
          : body,
    });
    let callbacks = 0;
    await expect(
      run(() =>
        Effect.sync(() => {
          callbacks++;
        }),
      ),
    ).rejects.toThrow();
    expect(callbacks).toBe(0);
  },
);

test.each<ResponseInit>([
  { status: 403 },
  { status: 206 },
  { status: 302, headers: { location: "https://foreign.example/" } },
  { headers: { "content-type": "application/json" } },
  {
    headers: { "content-type": "text/html", "content-range": "bytes 0-10/100" },
  },
  { headers: { "content-type": "text/html", "content-length": "1" } },
])(
  "Pick-A-Part VA fails closed at HTTP/body boundaries without retry (%#)",
  async (init) => {
    const calls = mockPages({ response: (body) => new Response(body, init) });
    await expect(run()).rejects.toThrow("previous inventory is preserved");
    expect(calls).toHaveLength(1);
  },
);

test("Pick-A-Part VA rejects valid-shaped forged counters and changed resumed snapshots before callbacks", async () => {
  const pages = [
    pickapartvaTestPage(pickapartvaTestRecords(), 1, 2),
    pickapartvaTestPage(pickapartvaTestRecords(2, 500), 2, 2),
  ];
  mockPages({ pages });
  const first = await run(undefined, undefined, 1);
  if (first.cursor.phase !== "pages")
    throw new Error("Expected paused fixture cursor");
  for (const cursor of [
    {
      ...first.cursor,
      emitted: first.cursor.emitted - 1,
      duplicates: first.cursor.duplicates + 1,
    },
    first.cursor,
  ]) {
    mockPages({
      pages,
      rewrite: (body) =>
        cursor === first.cursor
          ? body.replace("2026-11-10", "2026-11-11")
          : body,
    });
    let callbacks = 0;
    await expect(
      run(
        () =>
          Effect.sync(() => {
            callbacks++;
          }),
        cursor,
      ),
    ).rejects.toThrow("resume snapshot");
    expect(callbacks).toBe(0);
  }
});

test("Pick-A-Part VA rejects an entire repeated native payload below the duplicate-ratio cap", async () => {
  const pages = [0, 0, 500, 1000, 1500, 2000].map((offset, index) =>
    pickapartvaTestPage(
      pickapartvaTestRecords(index === 5 ? 2 : 500, offset),
      index + 1,
      6,
    ),
  );
  mockPages({ pages });
  let callbacks = 0;
  await expect(
    run(() =>
      Effect.sync(() => {
        callbacks++;
      }),
    ),
  ).rejects.toThrow("repeated");
  expect(callbacks).toBe(0);
});
