import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { streamAeroInventoryWithRequestGate } from "./aero-connector";
import type { AeroCursor } from "./aero-cursor";
import type { AeroRecord } from "./aero-parser";
import {
  aeroTestDirections,
  aeroTestHome,
  aeroTestPage,
  aeroTestRecord,
  aeroTestRow,
} from "./aero-test-fixtures";
import type { AeroCanonicalVehicle } from "./aero-transform";
import { AERO_YARD } from "./aero-yard-metadata";
import {
  DURABLE_SOURCE_DEFINITIONS,
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-source";
import { validateSourceSnapshot } from "./source-validation";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;

function mockInventory(
  options: {
    records?: readonly AeroRecord[];
    rewrite?: (body: string, path: string) => string;
    response?: (body: string, path: string) => Response;
  } = {},
) {
  const requests: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(url.origin).toBe("https://aeroautosalvage.com");
      requests.push(url.pathname);
      const bodies: Record<string, string> = {
        "/": aeroTestHome,
        "/directions/": aeroTestDirections,
        "/vehicle-inventory/": aeroTestPage(
          (options.records ?? [aeroTestRecord])
            .map((r) => aeroTestRow(r))
            .join(""),
        ),
      };
      const raw = bodies[url.pathname];
      if (raw === undefined) throw new Error("Unexpected Aero request");
      const body = options.rewrite?.(raw, url.pathname) ?? raw;
      return (
        options.response?.(body, url.pathname) ??
        new Response(body, {
          headers: { "Content-Type": "text/html; charset=UTF-8" },
        })
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}

const run = (
  onBatch = (_batch: AeroCanonicalVehicle[]) => Effect.void,
  cursor?: AeroCursor,
  maxPages = 1,
) =>
  Effect.runPromise(
    streamAeroInventoryWithRequestGate(
      { onBatch, startCursor: cursor, maxPages },
      gate,
    ),
  );

test("Aero completes one catalog after verifying official metadata and homepage controls", async () => {
  const requests = mockInventory();
  const vehicles: AeroCanonicalVehicle[] = [];
  const yards: (typeof AERO_YARD)[] = [];
  const result = await Effect.runPromise(
    streamAeroInventoryWithRequestGate(
      {
        onBatch: (batch) =>
          Effect.sync(() => {
            vehicles.push(...batch);
          }),
        onYards: (batch) =>
          Effect.sync(() => {
            yards.push(...batch);
          }),
      },
      gate,
    ),
  );
  expect(requests).toEqual(["/", "/directions/", "/vehicle-inventory/"]);
  expect(result).toMatchObject({
    status: "complete",
    count: 1,
    pagesProcessed: 1,
    accounting: {
      recordsProcessed: 1,
      recordsRejected: 0,
      recordsExcluded: 0,
      duplicateVehicles: 0,
    },
  });
  expect(vehicles[0]?.vin).toBe(aeroTestRecord.vin);
  expect(yards).toEqual([AERO_YARD]);
  expect(
    parseDurableSourceCursor(
      "aero",
      serializeDurableSourceCursor(result.cursor),
    ),
  ).toEqual({ source: "aero", phase: "complete" });
  expect(DURABLE_SOURCE_DEFINITIONS.aero.maxPagesPerChunk).toBe(1);
});

test.each([
  [
    "missing homepage control",
    (body: string, path: string) =>
      path === "/" ? body.replace("STK004808", "STK999999") : body,
  ],
  [
    "contradictory model control",
    (body: string, path: string) =>
      path === "/" ? body.replace("TITAN", "FRONTIER") : body,
  ],
  [
    "changed phone",
    (body: string, path: string) =>
      path === "/" ? body.replace("318-227-1010", "318-227-1011") : body,
  ],
  [
    "changed yard address",
    (body: string, path: string) =>
      path === "/directions/" ? body.replace("71107", "71108") : body,
  ],
  [
    "truncated catalog",
    (body: string, path: string) =>
      path === "/vehicle-inventory/" ? body.replace("</tbody>", "") : body,
  ],
] as const)("Aero blocks %s before all callbacks", async (_name, rewrite) => {
  mockInventory({ rewrite });
  let batches = 0;
  let yards = 0;
  await expect(
    Effect.runPromise(
      streamAeroInventoryWithRequestGate(
        {
          onBatch: () =>
            Effect.sync(() => {
              batches++;
            }),
          onYards: () =>
            Effect.sync(() => {
              yards++;
            }),
        },
        gate,
      ),
    ),
  ).rejects.toThrow("previous inventory is preserved");
  expect(batches).toBe(0);
  expect(yards).toBe(0);
});

const responseBoundaries: ResponseInit[] = [
  { status: 206, headers: { "content-type": "text/html" } },
  {
    status: 200,
    headers: { "content-type": "text/html", "content-range": "bytes 0-10/100" },
  },
  { status: 403, headers: { "content-type": "text/html" } },
  { status: 200, headers: { "content-type": "application/json" } },
  {
    status: 200,
    headers: { "content-type": "text/html", "content-length": "1" },
  },
];
test.each(responseBoundaries)(
  "Aero rejects invalid HTTP/body boundaries (%#)",
  async (init) => {
    mockInventory({ response: (body) => new Response(body, init) });
    await expect(run()).rejects.toThrow("previous inventory is preserved");
  },
);

test("Aero rejects a redirected response", async () => {
  mockInventory({
    response: (body) => {
      const response = new Response(body, {
        headers: { "content-type": "text/html" },
      });
      Object.defineProperty(response, "url", { value: "https://example.com/" });
      return response;
    },
  });
  await expect(run()).rejects.toThrow("redirected");
});

function records(count: number): AeroRecord[] {
  return Array.from({ length: count }, (_, index) => {
    const stock =
      index === 0
        ? aeroTestRecord.stock
        : "STK" + String(8000 + index).padStart(6, "0");
    return {
      ...aeroTestRecord,
      stock,
      vin:
        index === 0
          ? aeroTestRecord.vin
          : "1N6AA06A04N" + String(8000 + index).padStart(6, "0"),
      images: ["/inventoryphotos/" + stock + ".jpeg"],
    };
  });
}

test.each(["stock", "vin"] as const)(
  "Aero blocks duplicate %s identities",
  async (field) => {
    const rows = records(2).map((r) => ({
      ...r,
      [field]: aeroTestRecord[field],
    }));
    mockInventory({ records: rows });
    await expect(run()).rejects.toThrow("duplicate stock/VIN identities");
  },
);

test.each(["", "Unknown"])(
  "Aero admits repeated optional stock %j and recovers every homepage control",
  async (stock) => {
    const rows = records(2).map((record) => ({
      ...record,
      stock,
      color: "",
      row: "",
      arrived: "",
      images: [],
    }));
    const controls = rows.map((record) => aeroTestRow(record, true)).join("");
    mockInventory({
      records: rows,
      rewrite: (body, path) =>
        path === "/"
          ? body.replace(aeroTestRow(aeroTestRecord, true), controls)
          : body,
    });
    const vehicles: AeroCanonicalVehicle[] = [];
    const result = await run((batch) =>
      Effect.sync(() => {
        vehicles.push(...batch);
      }),
    );
    expect(result.count).toBe(2);
    expect(result.accounting?.recordsRejected).toBe(0);
    expect(vehicles.map((vehicle) => vehicle.stockNumber)).toEqual([
      null,
      null,
    ]);
    expect(vehicles[0]).toMatchObject({
      color: null,
      row: null,
      availableDate: null,
      imageUrl: null,
    });
  },
);

test("Aero requires a separate catalog row for each stockless homepage control", async () => {
  const rows = records(2).map((record) => ({ ...record, stock: "" }));
  const control = aeroTestRow({ ...aeroTestRecord, stock: "" }, true);
  mockInventory({
    records: rows,
    rewrite: (body, path) =>
      path === "/"
        ? body.replace(aeroTestRow(aeroTestRecord, true), control.repeat(3))
        : body,
  });
  await expect(run()).rejects.toThrow("homepage arrival controls");
});

test("Aero keeps rejected presence and applies the unchanged ten-percent limit before emitting", async () => {
  const rows = records(10).map((r, i) =>
    i === 9 ? { ...r, model: "Unknown" } : r,
  );
  mockInventory({ records: rows });
  const result = await run();
  expect(result.count).toBe(9);
  expect(result.accounting?.recordsRejected).toBe(1);
  expect(result.observedVins).toEqual(["1N6AA06A04N008009"]);
  mockInventory({
    records: rows.map((r, i) => (i === 8 ? { ...r, model: "Unknown" } : r)),
  });
  let emitted = false;
  await expect(
    run(() =>
      Effect.sync(() => {
        emitted = true;
      }),
    ),
  ).rejects.toThrow("10% rejection limit");
  expect(emitted).toBe(false);
});

test("Aero shared validation requires at least 43 admitted donors", () => {
  const input = {
    source: "aero",
    terminal: true,
    vehiclesProcessed: 141,
    uniqueVehicles: 135,
    duplicateVehicles: 0,
    rejectedVehicles: 6,
    errors: [],
    previousAcceptedCount: null,
  } as const;
  expect(validateSourceSnapshot({ ...input, errors: [] }).status).toBe(
    "accepted",
  );
  expect(
    validateSourceSnapshot({ ...input, uniqueVehicles: 42, errors: [] }).status,
  ).toBe("rejected");
});

test("Aero validates budgets before fetching and treats complete cursors idempotently", async () => {
  const requests = mockInventory();
  await expect(run(undefined, undefined, 0)).rejects.toThrow(
    "Invalid Aero cursor",
  );
  expect(() =>
    parseDurableSourceCursor("aero", '{"phase":"page","page":2}'),
  ).toThrow();
  expect(
    (await run(undefined, { source: "aero", phase: "complete" }))
      .pagesProcessed,
  ).toBe(0);
  expect(requests).toEqual([]);
});
