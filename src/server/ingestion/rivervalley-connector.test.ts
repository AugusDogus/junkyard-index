import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { soakRivervalleyInventory } from "../../../scripts/soak-rivervalley";
import { fetchRivervalleyControl } from "./rivervalley-client";
import { streamRivervalleyInventoryWithRequestGate } from "./rivervalley-connector";
import {
  RivervalleyCursor,
  RivervalleyCursorSchema,
} from "./rivervalley-cursor";
import {
  rivervalleyControl,
  rivervalleyPage,
  rivervalleyRecord,
} from "./rivervalley-test-fixtures";
import type { RivervalleyCanonicalVehicle } from "./rivervalley-transform";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
function mockInventory(
  alter?: (url: URL, body: string) => string | Response,
  total = 26,
) {
  const requests: URL[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push(url);
      if (url.origin !== "https://rivervalleytruckparts.com")
        throw new Error("Unexpected origin");
      let body: string;
      if (url.pathname === "/new-arrivals/") {
        expect(url.searchParams.get("f-condition")).toBe("nw");
        body = rivervalleyPage(
          Number(url.searchParams.get("page_number") ?? "1"),
          total,
        );
      } else if (
        url.pathname === "/truck-description/" &&
        url.searchParams.get("truck") === rivervalleyRecord.id
      )
        body = rivervalleyControl();
      else throw new Error("Unexpected River Valley test URL " + url);
      const value = alter ? alter(url, body) : body;
      return value instanceof Response
        ? value
        : new Response(value, { headers: { "Content-Type": "text/html" } });
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}
const run = (
  cursor: RivervalleyCursor = RivervalleyCursor.initial,
  maxPages = 16,
  onBatch = (_batch: RivervalleyCanonicalVehicle[]) => Effect.void,
) =>
  Effect.runPromise(
    streamRivervalleyInventoryWithRequestGate(
      { startCursor: cursor, maxPages, onBatch },
      gate,
    ),
  );

test("River Valley verifies active ownership and resumes the native Salvage catalog within request bounds", async () => {
  const requests = mockInventory();
  const vehicles: RivervalleyCanonicalVehicle[] = [];
  const onBatch = (batch: RivervalleyCanonicalVehicle[]) =>
    Effect.sync(() => {
      vehicles.push(...batch);
    });
  const first = await run(RivervalleyCursor.initial, 2, onBatch);
  expect(first).toMatchObject({
    status: "paused",
    count: 25,
    pagesProcessed: 2,
  });
  const cursor = RivervalleyCursorSchema.parse(
    JSON.parse(JSON.stringify(first.cursor)),
  );
  expect(cursor).toMatchObject({
    phase: "pages",
    nextPage: 2,
    total: 26,
    emitted: 25,
  });
  const enumerated = await run(cursor, 2, onBatch);
  expect(enumerated).toMatchObject({
    status: "paused",
    count: 1,
    pagesProcessed: 2,
    accounting: {
      recordsProcessed: 1,
      recordsRejected: 0,
      duplicateVehicles: 0,
    },
  });
  expect(enumerated.cursor).toMatchObject({ phase: "verify", verifyPage: 1 });
  const final = await run(
    RivervalleyCursorSchema.parse(
      JSON.parse(JSON.stringify(enumerated.cursor)),
    ),
    2,
    onBatch,
  );
  expect(final).toMatchObject({
    status: "complete",
    count: 0,
    pagesProcessed: 2,
    accounting: { recordsProcessed: 0 },
  });
  expect(vehicles).toHaveLength(26);
  expect(new Set(vehicles.map((vehicle) => vehicle.vin)).size).toBe(26);
  expect(requests.map((url) => url.pathname)).toEqual([
    "/new-arrivals/",
    "/truck-description/",
    "/new-arrivals/",
    "/new-arrivals/",
    "/new-arrivals/",
    "/new-arrivals/",
  ]);
  expect((await run(final.cursor)).pagesProcessed).toBe(0);
  expect(requests).toHaveLength(6);
});

test.each([
  "Now Wrecking",
  rivervalleyRecord.vin,
  "288 W South Tec Drive",
  "815-936-0406",
])("River Valley stops when its active control loses %s", async (required) => {
  mockInventory((url, body) =>
    url.pathname === "/truck-description/"
      ? body.replaceAll(required, "CHANGED")
      : body,
  );
  await expect(run()).rejects.toThrow(
    "Previously published inventory is preserved",
  );
});

test("River Valley preserves rejected VIN presence and cumulative rejection quality across resume", async () => {
  mockInventory((url, body) =>
    url.pathname === "/new-arrivals/"
      ? rivervalleyPage(
          Number(url.searchParams.get("page_number") ?? "1"),
          26,
          (row, index) =>
            index >= 1 && index <= 3 ? { ...row, model: "N/A" } : row,
        )
      : body,
  );
  const first = await run(RivervalleyCursor.initial, 2);
  expect(first).toMatchObject({
    count: 22,
    accounting: { recordsProcessed: 25, recordsRejected: 3 },
  });
  expect(first.observedVins).toHaveLength(3);
  const cursor = RivervalleyCursorSchema.parse(
    JSON.parse(JSON.stringify(first.cursor)),
  );
  await expect(run(cursor, 2)).rejects.toThrow("10% rejection");
});

test("River Valley deduplicates consistent native VINs across checkpoints", async () => {
  mockInventory((url, body) =>
    url.pathname === "/new-arrivals/"
      ? rivervalleyPage(
          Number(url.searchParams.get("page_number") ?? "1"),
          26,
          (row, index) =>
            index === 25 ? { ...row, vin: rivervalleyRecord.vin } : row,
        )
      : body,
  );
  const first = await run(RivervalleyCursor.initial, 2);
  const final = await run(
    RivervalleyCursorSchema.parse(JSON.parse(JSON.stringify(first.cursor))),
    4,
  );
  expect(final).toMatchObject({
    status: "complete",
    count: 0,
    accounting: { recordsProcessed: 1, duplicateVehicles: 1 },
  });
});

test("River Valley stops when the same VIN identifies contradictory YMM", async () => {
  mockInventory((url, body) =>
    url.pathname === "/new-arrivals/"
      ? rivervalleyPage(
          Number(url.searchParams.get("page_number") ?? "1"),
          26,
          (row, index) =>
            index === 25
              ? { ...row, vin: rivervalleyRecord.vin, model: "DIFFERENT" }
              : row,
        )
      : body,
  );
  const first = await run(RivervalleyCursor.initial, 2);
  await expect(run(first.cursor)).rejects.toThrow("VIN");
});

test("River Valley retains the cumulative 25% duplicate guard", async () => {
  mockInventory((url, body) =>
    url.pathname === "/new-arrivals/"
      ? rivervalleyPage(
          Number(url.searchParams.get("page_number") ?? "1"),
          26,
          (row) => ({ ...row, vin: rivervalleyRecord.vin }),
        )
      : body,
  );
  const first = await run(RivervalleyCursor.initial, 2);
  await expect(run(first.cursor)).rejects.toThrow("25% duplicate");
});

test.each(["range", "total", "repeated ID", "retail"])(
  "River Valley rejects changed native %s evidence",
  async (change) => {
    mockInventory((url, body) => {
      if (url.searchParams.get("page_number") !== "2") return body;
      if (change === "range") return rivervalleyPage(1);
      if (change === "total") return rivervalleyPage(2, 27);
      return rivervalleyPage(2, 26, (row) =>
        change === "retail"
          ? { ...row, condition: "Complete" }
          : { ...row, id: rivervalleyRecord.id },
      );
    });
    await expect(run()).rejects.toThrow(
      "Previously published inventory is preserved",
    );
  },
);

test("River Valley revalidates the prior page boundary before advancing a saved cursor", async () => {
  mockInventory();
  const first = await run(RivervalleyCursor.initial, 2);
  const requests = mockInventory((url, body) =>
    url.pathname === "/new-arrivals/"
      ? body.replaceAll("260645", "260646")
      : body,
  );
  await expect(run(first.cursor)).rejects.toThrow("boundary");
  expect(requests).toHaveLength(1);
});

test("River Valley detects earlier prefix drift before accepting terminal inventory", async () => {
  mockInventory(undefined, 51);
  const first = await run(RivervalleyCursor.initial, 3);
  expect(first.cursor).toMatchObject({ phase: "pages", nextPage: 3 });
  mockInventory(
    (url, body) =>
      url.pathname === "/new-arrivals/" && !url.searchParams.has("page_number")
        ? body
            .replaceAll(rivervalleyRecord.id, "296762")
            .replaceAll(rivervalleyRecord.vin, "4DRBUAAN0EB999999")
        : body,
    51,
  );
  await expect(run(first.cursor)).rejects.toThrow("prefix");
});

test("River Valley persists bounded terminal verification without emitting donors twice", async () => {
  const requests = mockInventory(undefined, 51);
  let cursor: RivervalleyCursor = RivervalleyCursor.initial;
  let emitted = 0;
  let verificationPauses = 0;
  while (cursor.phase !== "complete") {
    const chunk = await run(cursor, 2);
    expect(chunk.pagesProcessed).toBeLessThanOrEqual(2);
    emitted += chunk.count;
    cursor = RivervalleyCursorSchema.parse(
      JSON.parse(JSON.stringify(chunk.cursor)),
    );
    if (cursor.phase === "verify") verificationPauses++;
    if (requests.length > 12)
      throw new Error("River Valley verification did not finish");
  }
  expect(verificationPauses).toBe(2);
  expect(emitted).toBe(51);
  expect(requests).toHaveLength(9);
});

test("River Valley rechecks cumulative quality before completing a verification checkpoint", async () => {
  mockInventory();
  const first = await run(RivervalleyCursor.initial, 3);
  if (first.cursor.phase !== "verify")
    throw new Error("Expected terminal verification");
  const cursor = RivervalleyCursorSchema.parse({
    ...first.cursor,
    emitted: 23,
    rejected: 3,
    seen: first.cursor.seen.map((row, index) =>
      index < 3
        ? { id: row.id, status: "incomplete", vin: row.vin, identity: null }
        : row,
    ),
  });
  await expect(run(cursor)).rejects.toThrow("10% rejection");
});

test.each([
  () => new Response("Failed", { status: 403 }),
  () => new Response("Failed", { status: 500 }),
  () =>
    new Response("Partial", {
      status: 206,
      headers: { "Content-Type": "text/html" },
    }),
  () => new Response("[]", { headers: { "Content-Type": "application/json" } }),
  () =>
    new Response(rivervalleyPage(), {
      headers: { "Content-Type": "text/html", "Content-Length": "100" },
    }),
  () =>
    new Response(rivervalleyPage(), {
      headers: { "Content-Type": "text/html", "Content-Range": "bytes 0-1/3" },
    }),
  () =>
    new Response(" ".repeat(4 * 1024 * 1024 + 1), {
      headers: { "Content-Type": "text/html" },
    }),
])("River Valley rejects unsafe HTTP or body responses", async (response) => {
  mockInventory(() => response());
  await expect(run()).rejects.toThrow(
    "Previously published inventory is preserved",
  );
});

test("River Valley rejects redirects and malformed budgets without advancing", async () => {
  const requests = mockInventory();
  await expect(run(RivervalleyCursor.initial, 1)).rejects.toThrow("2-32");
  expect(requests).toHaveLength(0);
  mockInventory((_url, body) => {
    const response = new Response(body, {
      headers: { "Content-Type": "text/html" },
    });
    Object.defineProperty(response, "url", {
      value: "https://rivervalleytruckparts.com/login/",
    });
    return response;
  });
  await expect(run()).rejects.toThrow(
    "Previously published inventory is preserved",
  );
});

test("River Valley never requests a foreign active-control destination", async () => {
  const requests = mockInventory();
  await expect(
    Effect.runPromise(
      fetchRivervalleyControl(
        {
          ...rivervalleyRecord,
          detailsUrl:
            "https://another-yard.example/truck-description/?truck=196762",
        },
        gate,
      ),
    ),
  ).rejects.toThrow("native donor URL");
  expect(requests).toHaveLength(0);
});

test("River Valley callback failure leaves its input checkpoint intact", async () => {
  mockInventory();
  const first = await run(RivervalleyCursor.initial, 2);
  const saved = JSON.stringify(first.cursor);
  await expect(
    Effect.runPromise(
      streamRivervalleyInventoryWithRequestGate(
        {
          startCursor: first.cursor,
          maxPages: 2,
          onBatch: () => Effect.fail(new Error("consumer failed")),
        },
        gate,
      ),
    ),
  ).rejects.toThrow("consumer failed");
  expect(JSON.stringify(first.cursor)).toBe(saved);
});

test("River Valley bounded soak reports a partial request budget as paused", async () => {
  const requests = mockInventory();
  const result = await soakRivervalleyInventory(
    (cursor, maxPages) => run(cursor, maxPages),
    2,
  );
  expect(result).toMatchObject({
    status: "paused",
    count: 25,
    pagesProcessed: 2,
  });
  expect(requests).toHaveLength(2);
});
