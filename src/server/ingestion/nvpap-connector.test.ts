import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { streamNvpapInventoryWithRequestGate } from "./nvpap-connector";
import { NvpapCursorSchema, type NvpapCursor } from "./nvpap-cursor";
import type { NvpapRecord } from "./nvpap-parser";
import type { NvpapCanonicalVehicle } from "./nvpap-transform";
import {
  nvpapTestContext,
  nvpapTestRecord,
  nvpapTestResponse,
} from "./nvpap-test-fixtures";
import {
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-cursor";
import { DURABLE_SOURCE_DEFINITIONS } from "./durable-source";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
function mockInventory(
  options: {
    records?: (
      code: "1074" | "1075",
      year: number,
      records: NvpapRecord[],
    ) => NvpapRecord[];
    response?: (response: Response, url: URL) => Response;
  } = {},
) {
  const requests: { code: string; year: number }[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/contact.html")
        return (
          options.response?.(new Response(nvpapTestContext), url) ??
          new Response(nvpapTestContext)
        );
      if (
        url.pathname !== "/wp-json/pt1/v1/vehicle-stock" ||
        typeof init?.body !== "string"
      )
        throw new Error("Unexpected Nevada test request");
      expect(init.method).toBe("POST");
      const params = new URLSearchParams(init.body);
      expect(params.get("makes")).toBe("0");
      expect(params.get("models")).toBe("0");
      expect(params.get("beginDate")).toBe("");
      const code = params.get("store");
      if (code !== "1074" && code !== "1075")
        throw new Error("Unqualified Nevada store");
      const year = Number(params.get("years"));
      requests.push({ code, year });
      const stock = code === "1074" ? "L133425" : "H133425";
      const record = {
        ...nvpapTestRecord,
        stock,
        vin: code === "1074" ? nvpapTestRecord.vin : "1GCEG25H8B4121375",
        images: [
          "https://nvpap.com/photos/preview_photos/" + stock + "_left.JPG",
        ],
      };
      const rows = year === 0 || year === 1981 ? [record] : [];
      const response = new Response(
        nvpapTestResponse(options.records?.(code, year, rows) ?? rows, code),
      );
      return options.response?.(response, url) ?? response;
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}
const run = (
  startCursor?: NvpapCursor,
  maxPages = 16,
  onBatch = (_batch: NvpapCanonicalVehicle[]) => Effect.void,
) =>
  Effect.runPromise(
    streamNvpapInventoryWithRequestGate(
      { startCursor, maxPages, onBatch },
      gate,
    ),
  );

test("Nevada fully enumerates both yards through bounded, serialized checkpoints", async () => {
  const requests = mockInventory();
  const vehicles: NvpapCanonicalVehicle[] = [];
  const onBatch = (batch: NvpapCanonicalVehicle[]) =>
    Effect.sync(() => {
      vehicles.push(...batch);
    });
  let chunk = await run(undefined, 1, onBatch);
  expect(chunk.count).toBe(0);
  expect(chunk.pagesProcessed).toBe(1);
  expect(chunk.cursor).toMatchObject({
    phase: "year",
    year: 1886,
    processed: 0,
  });
  expect(DURABLE_SOURCE_DEFINITIONS.nvpap.maxPagesPerChunk).toBe(16);
  let queries = 1;
  while (chunk.status === "paused") {
    const cursor = parseDurableSourceCursor(
      "nvpap",
      serializeDurableSourceCursor(chunk.cursor),
    );
    chunk = await run(cursor, 16, onBatch);
    expect(chunk.pagesProcessed).toBeLessThanOrEqual(16);
    queries += chunk.pagesProcessed;
  }
  expect(queries).toBe(432);
  expect(requests).toHaveLength(432);
  expect(vehicles.map((v) => v.locationCode)).toEqual(["1074", "1075"]);
  expect(chunk.cursor).toEqual({ source: "nvpap", phase: "complete" });
});
test("Nevada fails if a year partition drops a known broad donor", async () => {
  mockInventory();
  await expect(
    run({
      source: "nvpap",
      phase: "year",
      yardCode: "1074",
      year: 2100,
      pending: ["L133425:2GCEG25H8B4121375"],
      processed: 1,
      emitted: 1,
      rejected: 0,
    }),
  ).rejects.toThrow("broad controls missing");
});
test("Nevada fails on saturated partitions before emitting that page", async () => {
  mockInventory({
    records: (_code, _year, records) =>
      records.flatMap((r) =>
        Array.from({ length: 200 }, (_, index) => ({
          ...r,
          stock: "L" + String(index).padStart(6, "0"),
        })),
      ),
  });
  await expect(
    run({
      source: "nvpap",
      phase: "year",
      yardCode: "1074",
      year: 1981,
      pending: [],
      processed: 0,
      emitted: 0,
      rejected: 0,
    }),
  ).rejects.toThrow("200-result cap");
});
test("Nevada preserves per-yard rejection counts across resumes", async () => {
  mockInventory();
  await expect(
    run({
      source: "nvpap",
      phase: "year",
      yardCode: "1074",
      year: 2100,
      pending: [],
      processed: 9,
      emitted: 8,
      rejected: 1,
    }),
  ).rejects.toThrow("failed completion");
});

test("Nevada records incomplete donors as presence without emitting incomplete listings", async () => {
  mockInventory({
    records: (_code, _year, rows) =>
      rows.map((r) => ({ ...r, model: "UNKNOWN" })),
  });
  const chunk = await run(
    {
      source: "nvpap",
      phase: "year",
      yardCode: "1074",
      year: 1981,
      pending: ["L133425:2GCEG25H8B4121375"],
      processed: 0,
      emitted: 0,
      rejected: 0,
    },
    1,
  );
  expect(chunk.count).toBe(0);
  expect(chunk.observedVins).toEqual([nvpapTestRecord.vin]);
  expect(chunk.cursor).toMatchObject({
    processed: 1,
    rejected: 1,
    emitted: 0,
    pending: [],
  });
});

test("Nevada emits donors with nullable optional metadata without counting rejection", async () => {
  mockInventory({
    records: (_code, _year, rows) =>
      rows.map((r) => ({
        ...r,
        color: "Unknown",
        row: "",
        date: "",
        images: [],
      })),
  });
  const vehicles: NvpapCanonicalVehicle[] = [];
  const chunk = await run(
    {
      source: "nvpap",
      phase: "year",
      yardCode: "1074",
      year: 1981,
      pending: ["L133425:2GCEG25H8B4121375"],
      processed: 0,
      emitted: 0,
      rejected: 0,
    },
    1,
    (batch) =>
      Effect.sync(() => {
        vehicles.push(...batch);
      }),
  );
  expect(chunk.count).toBe(1);
  expect(chunk.accounting.recordsRejected).toBe(0);
  expect(chunk.observedVins).toEqual([]);
  expect(chunk.cursor).toMatchObject({
    processed: 1,
    rejected: 0,
    emitted: 1,
    pending: [],
  });
  expect(vehicles[0]).toMatchObject({
    vin: nvpapTestRecord.vin,
    stockNumber: "L133425",
    color: null,
    row: null,
    availableDate: null,
    imageUrl: null,
  });
});

test("Nevada fails when official yard metadata changes", async () => {
  mockInventory({
    response: (response, url) =>
      url.pathname === "/contact.html"
        ? new Response(nvpapTestContext.replace("89115", "89116"))
        : response,
  });
  await expect(run()).rejects.toThrow("changed contact identity");
});

test("Nevada rejects partial HTTP responses before decoding inventory", async () => {
  mockInventory({
    response: (_response, url) =>
      url.pathname === "/contact.html"
        ? new Response(nvpapTestContext)
        : new Response("partial", { status: 206 }),
  });
  await expect(run()).rejects.toThrow("Partial response");
});
test("Nevada rejects HTTP 403 and invalid cursors without advancing", async () => {
  const requests = mockInventory({
    response: () => new Response("Forbidden", { status: 403 }),
  });
  await expect(run()).rejects.toThrow("HTTP 403");
  expect(requests).toHaveLength(0);
  expect(
    NvpapCursorSchema.safeParse({
      source: "nvpap",
      phase: "year",
      yardCode: "1074",
      year: 1981,
      pending: [],
      processed: 2,
      emitted: 1,
      rejected: 0,
    }).success,
  ).toBe(false);
  await expect(run(undefined, 0)).rejects.toThrow("Invalid Nevada checkpoint");
});
test("Nevada complete cursors are idempotent and make no requests", async () => {
  const requests = mockInventory();
  expect((await run({ source: "nvpap", phase: "complete" })).status).toBe(
    "complete",
  );
  expect(requests).toHaveLength(0);
});
