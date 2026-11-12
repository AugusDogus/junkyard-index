import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { z } from "zod";
import { soakUwrenchInventory } from "../../../scripts/soak-uwrench";
import { connectorChunkMetrics } from "./connector-chunk";
import { streamUwrenchInventoryWithRequestGate } from "./uwrench-connector";
import { UwrenchCursor, UWRENCH_MAX_CURSOR_BYTES } from "./uwrench-cursor";
import {
  parseUwrenchConfig,
  parseUwrenchInventory,
  uwrenchHash,
  uwrenchPairKey,
  type UwrenchNativeRow,
  type UwrenchRecord,
} from "./uwrench-parser";
import {
  uwrenchTestConfig,
  uwrenchTestInventory,
  uwrenchTestOwner,
  uwrenchTestRecord,
  uwrenchTestRow,
} from "./uwrench-test-fixtures";
import type { UwrenchCanonicalVehicle } from "./uwrench-transform";
import {
  UWRENCH_ANALYTICS_URL,
  UWRENCH_CONFIG_URL,
  UWRENCH_EMBED_URL,
  UWRENCH_INVENTORY_URL,
  UWRENCH_ORIGIN,
  UWRENCH_SEARCH_URL,
  UWRENCH_YARD,
} from "./uwrench-yard-metadata";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
const rows: UwrenchNativeRow[] = Array.from({ length: 10 }, (_, index) => ({
  ...uwrenchTestRow,
  stock: "STK" + String(802 + index).padStart(6, "0"),
}));
const records: UwrenchRecord[] = rows.map((row, index) => ({
  ...uwrenchTestRecord,
  stock: row.stock,
  vin: "1J4FA49S94P" + String(785631 + index),
}));
type Kind = "owner" | "inventory" | "config" | "analytics" | "search";
const querySchema = z
  .object({
    yard_id: z.literal("tri_state_u_wrench_and_save"),
    year_min: z.null(),
    year_max: z.null(),
    make: z.string().min(1),
    model: z.string().min(1),
    language: z.literal("en"),
    location_id: z.null(),
  })
  .strict();
function mock(
  options: {
    native?: readonly UwrenchNativeRow[];
    api?: readonly UwrenchRecord[];
    select?: (
      pair: { make: string; model: string },
      ordinal: number,
    ) => readonly UwrenchRecord[];
    rewrite?: (
      body: string,
      kind: Kind,
      context: number,
      selector: number,
    ) => string;
    response?: (body: string, kind: Kind) => Response;
  } = {},
) {
  const native = options.native ?? rows;
  const api = options.api ?? records;
  const requests: Kind[] = [];
  let contexts = 0,
    selectors = 0;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      const url = input instanceof Request ? input.url : String(input);
      let kind: Kind, body: string;
      if (url === UWRENCH_ORIGIN + "/") {
        kind = "owner";
        contexts++;
        body = uwrenchTestOwner;
      } else if (url === UWRENCH_INVENTORY_URL) {
        kind = "inventory";
        body = uwrenchTestInventory(native);
      } else if (url === UWRENCH_CONFIG_URL) {
        kind = "config";
        body = uwrenchTestConfig;
      } else if (url === UWRENCH_ANALYTICS_URL) {
        kind = "analytics";
        const years = new Map<number, number>();
        for (const record of api)
          years.set(record.year, (years.get(record.year) ?? 0) + 1);
        body = JSON.stringify({
          success: true,
          data: {
            current_count: api.length,
            by_year: [...years].map(([year, count]) => ({
              year: String(year),
              count,
            })),
          },
        });
      } else if (url === UWRENCH_SEARCH_URL) {
        kind = "search";
        selectors++;
        expect(init?.method).toBe("POST");
        const query = querySchema.parse(
          JSON.parse(typeof init?.body === "string" ? init.body : ""),
        );
        const selected = options.select?.(query, selectors) ?? api;
        body = JSON.stringify({
          success: true,
          match_count: selected.length,
          matches: selected,
          search_criteria: {
            yard_id: query.yard_id,
            year_min: null,
            year_max: null,
            make: query.make,
            model: query.model,
          },
        });
      } else throw new Error("Unsaved Tri-State request " + url);
      requests.push(kind);
      body = options.rewrite?.(body, kind, contexts, selectors) ?? body;
      return (
        options.response?.(body, kind) ??
        new Response(body, {
          headers: {
            "content-type":
              kind === "owner" || kind === "inventory"
                ? "text/html"
                : "application/json",
          },
        })
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}
const run = (
  cursor: UwrenchCursor = UwrenchCursor.initial,
  maxPages = 16,
  onBatch: (
    batch: UwrenchCanonicalVehicle[],
  ) => Effect.Effect<void, Error> = () => Effect.void,
) =>
  Effect.runPromise(
    streamUwrenchInventoryWithRequestGate(
      { startCursor: cursor, maxPages, onBatch },
      gate,
    ),
  );

test("terminal-only emission roundtrips the source-omitting codec and actual summed metrics", async () => {
  const requests = mock();
  const emitted: UwrenchCanonicalVehicle[] = [];
  const sums = {
    vehiclesProcessed: 0,
    uniqueVehicles: 0,
    rejectedVehicles: 0,
    duplicateVehicles: 0,
  };
  const first = await run(undefined, 1, (batch) =>
    Effect.sync(() => {
      emitted.push(...batch);
    }),
  );
  expect(first).toMatchObject({
    status: "paused",
    count: 0,
    accounting: { recordsProcessed: 0, recordsRejected: 0 },
  });
  expect(emitted).toEqual([]);
  const wire = UwrenchCursor.serialize(first.cursor);
  expect(JSON.parse(wire)).not.toHaveProperty("source");
  const last = await run(UwrenchCursor.parse(wire), 1, (batch) =>
    Effect.sync(() => {
      emitted.push(...batch);
    }),
  );
  for (const chunk of [first, last]) {
    const metrics = connectorChunkMetrics(chunk, chunk.count);
    sums.vehiclesProcessed += metrics.vehiclesProcessed;
    sums.uniqueVehicles += metrics.uniqueVehicles;
    sums.rejectedVehicles += metrics.rejectedVehicles;
    sums.duplicateVehicles += metrics.duplicateVehicles;
  }
  expect(last.status).toBe("complete");
  expect(sums).toEqual({
    vehiclesProcessed: 10,
    uniqueVehicles: 10,
    rejectedVehicles: 0,
    duplicateVehicles: 0,
  });
  expect(emitted.map((row) => row.stockNumber)).toEqual(
    rows.map((row) => row.stock),
  );
  expect(requests).toHaveLength(14);
  const prior = requests.length;
  expect((await run(last.cursor)).count).toBe(0);
  expect(requests).toHaveLength(prior);
});

test("mutable terminal callbacks cannot change source accounting or yard metadata", async () => {
  mock();
  const expectedYard = { ...UWRENCH_YARD };
  const first = await run();
  let delivered = 0;
  const complete = await Effect.runPromise(
    streamUwrenchInventoryWithRequestGate(
      {
        startCursor: first.cursor,
        onBatch: (batch) =>
          Effect.sync(() => {
            delivered = batch.length;
            batch.splice(0, batch.length);
          }),
        onYards: (yards) =>
          Effect.sync(() => {
            for (const yard of yards)
              Reflect.set(yard, "name", "Mutated callback yard");
            yards.splice(0, yards.length);
          }),
      },
      gate,
    ),
  );
  expect(delivered).toBe(10);
  expect(complete.count).toBe(10);
  expect(connectorChunkMetrics(complete, complete.count)).toEqual({
    vehiclesProcessed: 10,
    uniqueVehicles: 10,
    rejectedVehicles: 0,
    duplicateVehicles: 0,
  });
  expect(UWRENCH_YARD).toEqual(expectedYard);
});

test("legacy context without explicit API scope cannot resume further inventory queries", async () => {
  const requests = mock();
  const first = await run();
  if (first.cursor.phase !== "verify")
    throw new Error("Expected completed fixture scan");
  const table = parseUwrenchInventory(uwrenchTestInventory(rows));
  // This is the actual pre-scope-binding context contract, not an arbitrary
  // corrupt hash. Its otherwise valid retained query must require a restart.
  const legacy = UwrenchCursor.checkpoint({
    ...first.cursor,
    contextHash: uwrenchHash({
      contract: "native-authority-whole-native-ymm-v1",
      owner: UWRENCH_YARD,
      embed: UWRENCH_EMBED_URL,
      rows: table.rows,
      pairs: table.pairs,
      config: parseUwrenchConfig(uwrenchTestConfig),
      counts: {
        count: records.length,
        years: [{ year: uwrenchTestRecord.year, count: records.length }],
      },
    }),
  });
  const before = requests.length;
  let callbacks = 0;
  await expect(
    run(legacy, 16, () =>
      Effect.sync(() => {
        callbacks++;
      }),
    ),
  ).rejects.toThrow("native rows, owner/config or API count context changed");
  expect(requests.slice(before)).toEqual([
    "owner",
    "inventory",
    "config",
    "analytics",
  ]);
  expect(callbacks).toBe(0);
});

test("missing enrichment and owned API-only stock are explicit union rejections", async () => {
  mock({ api: records.slice(0, 9) });
  const missing = await soakUwrenchInventory((cursor, budget) =>
    run(cursor, budget),
  );
  expect(missing).toMatchObject({
    status: "complete",
    count: 9,
    observedVins: [],
    accounting: {
      recordsProcessed: 10,
      recordsRejected: 1,
      recordsExcluded: 0,
      duplicateVehicles: 0,
    },
  });
  const extra: UwrenchRecord = {
    ...uwrenchTestRecord,
    stock: "STK999999",
    vin: "1J4FA49S94P999999",
  };
  mock({ api: [...records, extra] });
  const quarantine = await soakUwrenchInventory((cursor, budget) =>
    run(cursor, budget),
  );
  expect(quarantine).toMatchObject({
    status: "complete",
    count: 10,
    observedVins: ["1J4FA49S94P999999"],
    accounting: { recordsProcessed: 11, recordsRejected: 1 },
  });
});

test("zero-match successful selector preserves native census without invented identity", async () => {
  const firstRow = rows[0];
  if (!firstRow) throw new Error("Missing fixture");
  mock({
    native: [{ ...firstRow, model: "UNAVAILABLE" }, ...rows.slice(1)],
    api: records.slice(1),
    select: (pair) => (pair.model === "UNAVAILABLE" ? [] : records.slice(1)),
  });
  const complete = await soakUwrenchInventory((cursor, budget) =>
    run(cursor, Math.min(budget, 1)),
  );
  expect(complete).toMatchObject({
    status: "complete",
    count: 9,
    observedVins: [],
    accounting: { recordsProcessed: 10, recordsRejected: 1 },
  });
});

test("unusable native YMM rejects its row and preserves separately valid presence", async () => {
  mock({
    native: rows.map((row, index) =>
      index === 0 ? { ...row, model: "" } : row,
    ),
  });
  const complete = await soakUwrenchInventory((cursor, budget) =>
    run(cursor, budget),
  );
  expect(complete).toMatchObject({
    status: "complete",
    count: 9,
    observedVins: ["1J4FA49S94P785631"],
    accounting: { recordsProcessed: 10, recordsRejected: 1 },
  });
});

test("checkpoint cap and retained earliest full-record integrity fail before emissions", async () => {
  expect(() =>
    UwrenchCursor.parse(" ".repeat(UWRENCH_MAX_CURSOR_BYTES + 1)),
  ).toThrow("1 MiB");
  const native = rows.map((row, index) =>
    index === 0 ? { ...row, model: "CHEROKEE" } : row,
  );
  const requests = mock({ native });
  const first = await run(undefined, 1);
  if (first.cursor.phase !== "scan") throw new Error("Expected partial scan");
  const entry = first.cursor.entries[0];
  if (!entry) throw new Error("Expected retained complete record");
  const corrupt = UwrenchCursor.checkpoint({
    ...first.cursor,
    entries: [
      { ...entry, record: { ...entry.record, color: "BLUE" } },
      ...first.cursor.entries.slice(1),
    ],
  });
  let callbacks = 0;
  await expect(
    run(corrupt, 1, () =>
      Effect.sync(() => {
        callbacks++;
      }),
    ),
  ).rejects.toThrow("fingerprint");
  expect(callbacks).toBe(0);
  const before = requests.length;
  await expect(run(undefined, 0)).rejects.toThrow("budget");
  expect(requests).toHaveLength(before);
});

test("changed earlier API source fields or terminal native bookend cannot complete", async () => {
  for (const mode of ["query", "native"] as const) {
    mock({
      rewrite: (body, kind, context, selector) =>
        mode === "query" && kind === "search" && selector === 2
          ? body.replace('"color":"RED"', '"color":"BLUE"')
          : mode === "native" && kind === "inventory" && context === 3
            ? body.replace("100306. 4.0", "5.0")
            : body,
    });
    const first = await run();
    let callbacks = 0;
    await expect(
      run(first.cursor, 16, () =>
        Effect.sync(() => {
          callbacks++;
        }),
      ),
    ).rejects.toThrow(mode === "query" ? "whole stable" : "changed");
    expect(callbacks).toBe(0);
  }
});

test("failed terminal callback preserves original cursor and can replay", async () => {
  mock();
  const first = await run();
  await expect(
    run(first.cursor, 16, () => Effect.fail(new Error("staging failed"))),
  ).rejects.toThrow("staging failed");
  expect(
    (await run(UwrenchCursor.parse(UwrenchCursor.serialize(first.cursor))))
      .status,
  ).toBe("complete");
});

test("bad count, foreign scope and partial HTTP never become missing-identity success", async () => {
  for (const mode of ["count", "owner", "partial"] as const) {
    const requests = mock({
      rewrite: (body, kind) =>
        kind !== "search"
          ? body
          : mode === "count"
            ? body.replace('"match_count":10', '"match_count":11')
            : mode === "owner"
              ? body.replaceAll(
                  '"Tri-State U-Wrench and Save"',
                  '"Foreign yard"',
                )
              : body,
      response:
        mode === "partial"
          ? (body, kind) =>
              new Response(body, {
                status: kind === "search" ? 206 : 200,
                headers: {
                  "content-type":
                    kind === "owner" || kind === "inventory"
                      ? "text/html"
                      : "application/json",
                },
              })
          : undefined,
    });
    await expect(run()).rejects.toThrow();
    expect(requests.filter((kind) => kind === "search")).toHaveLength(1);
  }
  expect(uwrenchPairKey(uwrenchTestRow)).toBe('["JEEP","WRANGLER"]');
});
