import { afterEach, expect, test } from "bun:test";
import {
  isDurableSourceCursorTerminal,
  serializeDurableSourceCursor,
} from "./durable-source";
import { readFileSync } from "node:fs";
import { Effect } from "effect";
import { streamFenixInventoryWithRequestGate } from "./fenix-connector";
import { FenixCursor, FenixCursorSchema } from "./fenix-cursor";
import type { FenixOrder, FenixRecord } from "./fenix-parser";
import type { FenixCanonicalVehicle } from "./fenix-transform";
import {
  FENIX_YARD_CODES,
  FENIX_YARDS,
  type FenixYardCode,
} from "./fenix-yard-metadata";
import {
  fenixTestPage,
  fenixTestRecord,
  fenixTestRow,
} from "./fenix-test-fixtures";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;

test("Fenix stops after the saved Moultrie HTTP 403 without staging donors", async () => {
  const body = readFileSync(
    new URL("./fenix-test-fixtures/moultrie-forbidden.html", import.meta.url),
    "utf8",
  );
  let requests = 0;
  let batches = 0;
  globalThis.fetch = Object.assign(
    async () => {
      requests++;
      return new Response(body, {
        status: 403,
        headers: { "content-type": "text/html" },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  await expect(
    run(undefined, undefined, () =>
      Effect.sync(() => {
        batches++;
      }),
    ),
  ).rejects.toThrow("unredirected HTTP 200");
  expect(requests).toBe(1);
  expect(batches).toBe(0);
});
function record(yard: FenixYardCode, index = 1): FenixRecord {
  const offset = FENIX_YARD_CODES.indexOf(yard) * 1000 + index;
  const id = String(204000000 + offset);
  return {
    ...fenixTestRecord,
    id,
    stock: id,
    vin: "1FMFU16LX4LA" + String(offset).padStart(5, "0"),
    location: FENIX_YARDS[yard].city + ", " + FENIX_YARDS[yard].state,
    photoUrl: null,
  };
}
function mockInventory(
  options: {
    records?: (
      yard: FenixYardCode,
      order: FenixOrder,
      page: number,
    ) => FenixRecord[];
    lastPage?: number;
    rewrite?: (
      body: string,
      yard: FenixYardCode,
      order: FenixOrder,
      page: number,
    ) => string;
    response?: (body: string) => Response;
  } = {},
) {
  const requests: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(url.origin).toBe("https://fenixupull.com");
      expect(url.pathname).toBe("/recent-inventory/");
      expect(init?.redirect).toBe("error");
      const cookie = new Headers(init?.headers).get("Cookie");
      const yard =
        cookie === "fnx_location=1"
          ? "elmira"
          : cookie === "fnx_location=2"
            ? "binghamton"
            : cookie === "fnx_location=3"
              ? "east-syracuse"
              : cookie === "fnx_location=4"
                ? "moultrie"
                : null;
      if (!yard)
        throw new Error("Unexpected native public location preference");
      const order =
        url.searchParams.get("sort_direction") === "ASC" ? "ASC" : "DESC";
      const page = Number(url.searchParams.get("pg") ?? 1);
      requests.push(`${yard}/${order}/${page}`);
      const rows = options.records?.(yard, order, page) ?? [record(yard)];
      const body = fenixTestPage(
        rows.map(fenixTestRow).join(""),
        yard,
        order,
        page,
        options.lastPage ?? 1,
      );
      return (
        options.response?.(body) ??
        new Response(options.rewrite?.(body, yard, order, page) ?? body, {
          headers: { "content-type": "text/html; charset=UTF-8" },
        })
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}
const run = (
  startCursor: FenixCursor = FenixCursor.initial,
  maxPages = 32,
  onBatch: (batch: FenixCanonicalVehicle[]) => Effect.Effect<void, Error> = (
    _batch,
  ) => Effect.void,
) =>
  Effect.runPromise(
    streamFenixInventoryWithRequestGate(
      { startCursor, maxPages, onBatch },
      gate,
    ),
  );

test("Fenix completes both published orders and controls for all four physical yards", async () => {
  const requests = mockInventory();
  const vehicles: FenixCanonicalVehicle[] = [];
  const result = await run(undefined, undefined, (batch) =>
    Effect.sync(() => {
      vehicles.push(...batch);
    }),
  );
  expect(result).toMatchObject({
    status: "complete",
    count: 4,
    pagesProcessed: 24,
    accounting: {
      recordsProcessed: 8,
      recordsExcluded: 4,
      recordsRejected: 0,
      duplicateVehicles: 0,
    },
  });
  expect(vehicles.map((v) => v.locationCode)).toEqual([...FENIX_YARD_CODES]);
  expect(vehicles.every((v) => v.color === null && v.imageUrl === null)).toBe(
    true,
  );
  expect(requests).toHaveLength(24);
  expect((await run(result.cursor)).count).toBe(0);
  expect(requests).toHaveLength(24);
});

test("Fenix date-tie union recovers donors missing from each order across serialized checkpoints", async () => {
  mockInventory({
    lastPage: 2,
    records: (yard, order, page) => {
      if (page === 2) return [record(yard, order === "DESC" ? 50 : 2)];
      return Array.from({ length: 50 }, (_, i) =>
        record(yard, i + (order === "DESC" ? 1 : 2)),
      );
    },
  });
  let cursor: FenixCursor = FenixCursor.initial;
  const vehicles: FenixCanonicalVehicle[] = [];
  let rejected = 0;
  let duplicates = 0;
  for (let i = 0; i < 60; i++) {
    const chunk = await run(cursor, 3, (batch) =>
      Effect.sync(() => {
        vehicles.push(...batch);
      }),
    );
    cursor = FenixCursorSchema.parse(JSON.parse(JSON.stringify(chunk.cursor)));
    rejected += chunk.accounting?.recordsRejected ?? 0;
    duplicates += chunk.accounting?.duplicateVehicles ?? 0;
    if (chunk.status === "complete") break;
  }
  expect(cursor.phase).toBe("complete");
  expect(vehicles).toHaveLength(204);
  expect(
    isDurableSourceCursorTerminal(
      "fenix",
      serializeDurableSourceCursor(cursor),
    ),
  ).toBe(true);
  expect(new Set(vehicles.map((v) => v.vin)).size).toBe(204);
  expect(duplicates).toBe(8);
  expect(rejected).toBe(0);
});

test("Fenix refuses an incomplete single-order union", async () => {
  mockInventory({
    lastPage: 2,
    records: (yard, _order, page) =>
      page === 2
        ? [record(yard, 50)]
        : Array.from({ length: 50 }, (_, i) => record(yard, i + 1)),
  });
  await expect(run()).rejects.toThrow("exact published census");
});

test("Fenix preserves eligible rejected VIN presence and enforces per-yard rejection quality", async () => {
  mockInventory({
    records: (yard) =>
      Array.from({ length: 11 }, (_, i) => ({
        ...record(yard, i + 1),
        model: i === 0 ? "" : "EXPEDITION",
      })),
  });
  const result = await run();
  expect(result.count).toBe(40);
  expect(result.observedVins).toHaveLength(4);
  expect(result.accounting?.recordsRejected).toBe(4);
  mockInventory({
    records: (yard) =>
      Array.from({ length: 9 }, (_, i) => ({
        ...record(yard, i + 1),
        model: i === 0 ? "" : "EXPEDITION",
      })),
  });
  await expect(run()).rejects.toThrow("10% rejection limit");
});

test("Fenix rejects same-VIN different-stock and cross-yard ownership collisions", async () => {
  mockInventory({
    records: (yard) => [
      record(yard),
      { ...record(yard, 2), vin: record(yard).vin },
    ],
  });
  await expect(run()).rejects.toThrow("Different native details reuse VIN");
  mockInventory({
    records: (yard) => [{ ...record(yard), vin: record("elmira").vin }],
  });
  await expect(run()).rejects.toThrow("Different native details reuse VIN");
});

test("Fenix rejects changed opposite-sort objects and resume drift", async () => {
  mockInventory({
    records: (yard, order) => [
      { ...record(yard), model: order === "ASC" ? "changed" : "EXPEDITION" },
    ],
  });
  await expect(run()).rejects.toThrow("Repeated native detail changed");
  mockInventory({
    lastPage: 2,
    records: (yard, _order, page) =>
      page === 2
        ? [record(yard, 51)]
        : Array.from({ length: 50 }, (_, i) => record(yard, i + 1)),
  });
  const first = await run(undefined, 3);
  mockInventory({
    lastPage: 2,
    records: (yard, _order, page) =>
      page === 2
        ? [record(yard, 51)]
        : Array.from({ length: 50 }, (_, i) => ({
            ...record(yard, i + 1),
            model: "changed",
          })),
  });
  await expect(run(first.cursor, 3)).rejects.toThrow("resume drift");
});

test("Fenix rejects tampered checkpoint row ownership and redirect destinations", async () => {
  mockInventory();
  const first = await run(undefined, 3);
  if (first.cursor.phase === "start" || first.cursor.phase === "complete")
    throw new Error("Expected active checkpoint");
  const corrupted = { ...first.cursor, entries: first.cursor.entries.slice(1) };
  expect(FenixCursorSchema.safeParse(corrupted).success).toBe(false);
  mockInventory({
    response: (body) => {
      const response = new Response(body, {
        headers: { "content-type": "text/html" },
      });
      Object.defineProperty(response, "url", {
        value: "https://unrelated.example/",
      });
      return response;
    },
  });
  await expect(run()).rejects.toThrow("unredirected HTTP 200");
});

test("Fenix keeps terminal and completed-yard checkpoints backed by bookend proof", async () => {
  mockInventory();
  const result = await run();
  if (result.cursor.phase !== "complete")
    throw new Error("Expected terminal checkpoint");
  expect(
    FenixCursorSchema.safeParse({ ...result.cursor, checks: [] }).success,
  ).toBe(false);
  expect(
    FenixCursorSchema.safeParse({
      ...result.cursor,
      pages: result.cursor.pages.slice(1),
    }).success,
  ).toBe(false);
});

test("Fenix propagates HTTP and staging callback failures without returning a checkpoint", async () => {
  mockInventory({
    response: () =>
      new Response("unavailable", {
        status: 503,
        headers: { "content-type": "text/html" },
      }),
  });
  await expect(run()).rejects.toThrow("unredirected HTTP 200");
  mockInventory();
  await expect(
    run(undefined, undefined, () => Effect.fail(new Error("stage failed"))),
  ).rejects.toThrow("stage failed");
});

test("Fenix emits genuine optional photos without making image requests", async () => {
  const requests = mockInventory({
    records: (yard) => {
      const value = record(yard);
      return [
        {
          ...value,
          photoUrl: `https://fenixupull.com/wp-content/uploads/2026/11/${value.id}_1-150x100.jpg`,
        },
      ];
    },
  });
  const vehicles: FenixCanonicalVehicle[] = [];
  await run(undefined, undefined, (batch) =>
    Effect.sync(() => {
      vehicles.push(...batch);
    }),
  );
  expect(vehicles).toHaveLength(4);
  expect(
    vehicles.every((vehicle) =>
      vehicle.imageUrl?.endsWith(`${vehicle.stockNumber}_1-150x100.jpg`),
    ),
  ).toBe(true);
  expect(requests).toHaveLength(24);
});

test("Fenix retains the within-order duplicate limit even when the union is complete", async () => {
  mockInventory({
    lastPage: 2,
    records: (yard, order, page) => {
      const offset = order === "DESC" ? 0 : 30;
      const ids =
        page === 1
          ? Array.from({ length: 50 }, (_, i) => i + 1)
          : [
              ...Array.from({ length: 20 }, (_, i) => i + 51),
              ...Array.from({ length: 30 }, (_, i) => i + 1),
            ];
      return ids.map((id) => record(yard, id + offset));
    },
  });
  await expect(run()).rejects.toThrow("duplicate ratio exceeds 25%");
});

test("Fenix rejects a changed completion bookend", async () => {
  let descHeads = 0;
  mockInventory({
    rewrite: (body, yard, order) => {
      if (yard === "elmira" && order === "DESC") descHeads++;
      return descHeads > 1 ? body.replaceAll("EXPEDITION", "CHANGED") : body;
    },
  });
  await expect(run()).rejects.toThrow("completion drift");
});
