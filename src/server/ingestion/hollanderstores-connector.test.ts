import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Effect } from "effect";
import { streamHollanderstoresInventory } from "./hollanderstores-connector";
import {
  hollanderstoresSeed,
  HollanderstoresProviderError,
} from "./hollanderstores-client";
import {
  hollanderstoresMissing,
  HollanderstoresCursor,
} from "./hollanderstores-cursor";
import { parseHollanderstoresPage } from "./hollanderstores-parser";
import { hollanderstoresSnapshot } from "./hollanderstores-snapshot";
import {
  HOLLANDERSTORES_YARDS,
  type HollanderstoresYard,
} from "./hollanderstores-yard-metadata";
import { hollanderstoresVin } from "./hollanderstores-vin";
import type { HollanderstoresVehicle } from "./hollanderstores-snapshot";
import {
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
  getDurableSourceDefinition,
} from "./durable-source";
import { IngestionSourceFlags } from "./ingestion-source-flags";

const fixture = (code: string) =>
  gunzipSync(
    readFileSync(
      `${import.meta.dir}/hollanderstores-test-fixtures/${code}.html.gz`,
    ),
  ).toString("utf8");
const pages = () =>
  HOLLANDERSTORES_YARDS.map((yard, index) =>
    parseHollanderstoresPage(fixture(yard.code), index),
  );
const decode = (vins: readonly string[]) =>
  Effect.succeed(
    Object.fromEntries(
      vins.map((vin) => [vin, hollanderstoresSeed[vin] ?? null]),
    ),
  );

describe("Hollander Stores saved complete census", () => {
  test("qualifies every separate yard, rejecting VIN errors and retaining published conflicting makes", () => {
    const value = hollanderstoresSnapshot(pages(), hollanderstoresSeed);
    expect(value.errors).toEqual([]);
    expect(value.perYard).toEqual([
      {
        code: "leblancsauto",
        accepted: 541,
        rejected: 0,
        duplicates: 0,
        total: 541,
      },
      {
        code: "blvdautoparts",
        accepted: 83,
        rejected: 0,
        duplicates: 0,
        total: 83,
      },
      {
        code: "standardauto",
        accepted: 79,
        rejected: 6,
        duplicates: 0,
        total: 85,
      },
      {
        code: "petrillosauto",
        accepted: 59,
        rejected: 2,
        duplicates: 0,
        total: 61,
      },
      {
        code: "kirchhaynautopa",
        accepted: 114,
        rejected: 0,
        duplicates: 0,
        total: 114,
      },
    ]);
    expect(value.vehicles).toHaveLength(876);
    expect(
      value.vehicles.find((row) => row.vin === "5GTEN13E788122266")?.make,
    ).toBe("American Motors");
    expect(
      value.warnings.some((message) => message.includes("NHTSA HUMMER")),
    ).toBe(true);
    expect(
      value.warnings.some((message) => message.includes("NHTSA DODGE")),
    ).toBe(true);
    expect(value.warnings.some((message) => message.includes("ALFA"))).toBe(
      false,
    );
    expect(value.observedVins).toHaveLength(6);
  });
  test("rejects failed make lookups without inventing a make and guards each yard", () => {
    const value = hollanderstoresSnapshot(pages(), {});
    expect(value.errors).toContain(
      "LeBlanc's Auto rejection ratio exceeds 10%",
    );
    const standard = pages();
    const row = standard[2]?.rows.find(
      (row) => row.make !== null && hollanderstoresVin(row.vin),
    );
    if (!row) throw new Error("Expected a valid Standard fixture row");
    row.vin = "5J8TB4H35DL015047";
    expect(
      hollanderstoresSnapshot(standard, hollanderstoresSeed).perYard[2]
        ?.rejected,
    ).toBe(7);
    const failing = pages();
    const valid =
      failing[2]?.rows
        .filter((row) => hollanderstoresVin(row.vin))
        .slice(0, 3) ?? [];
    for (const row of valid) row.vin = row.vin.slice(0, 16);
    expect(
      hollanderstoresSnapshot(failing, hollanderstoresSeed).errors,
    ).toContain(
      "Standard Used Auto Parts & Wrecking rejection ratio exceeds 10%",
    );
    expect(
      hollanderstoresSnapshot(pages(), hollanderstoresSeed, 2000).errors,
    ).toContain(
      "Hollander Stores inventory fell below the previous-run 50% drift limit",
    );
  });
  test("rejects count loss, truncation, foreign tenant links and yard substitution", () => {
    const raw = fixture("standardauto");
    for (const changed of [
      raw.replace("Showing 85", "Showing 86"),
      raw.slice(0, -100),
      raw.replace(
        "/VehicleDealerShowParts/2329/",
        "/VehicleDealerShowParts/4573/",
      ),
      raw.replace("Standard Auto Parts</a>", "Other Yard</a>"),
    ])
      expect(() => parseHollanderstoresPage(changed, 2)).toThrow();
  });
  test("conflicting duplicate identities are rejects and preserve presence", () => {
    const input = pages();
    const row = input[0]?.rows[0];
    const other = input[1]?.rows[0];
    if (!row || !other) throw new Error("Expected fixture rows");
    other.vin = row.vin;
    const value = hollanderstoresSnapshot(input, hollanderstoresSeed);
    expect(value.vehicles.some((vehicle) => vehicle.vin === row.vin)).toBe(
      false,
    );
    expect(value.observedVins).toContain(row.vin);
  });
  test("VIN check digit is provider scoped", () => {
    expect(hollanderstoresVin("5J8TB4H35DL015046")).toBe("5J8TB4H35DL015046");
    expect(hollanderstoresVin("NM0LS6ANLCT101712")).toBeNull();
    expect(hollanderstoresVin("1FMCU9GX3GUA5743")).toBeNull();
    expect(hollanderstoresVin("5J8TB4H35DL015047")).toBeNull();
  });
  test("durable chunks round trip, emit only after closing and perform no work on terminal resume", async () => {
    const batches: HollanderstoresVehicle[][] = [],
      calls: string[] = [],
      decoded: string[] = [];
    const onBatch = (vehicles: HollanderstoresVehicle[]) =>
      Effect.sync(() => {
        batches.push(vehicles);
      });
    const readPage = (yard: HollanderstoresYard) =>
      Effect.sync(() => {
        calls.push(yard.code);
        return fixture(yard.code + (calls.length > 5 ? "-closing" : ""));
      });
    const decodeBatch = (vins: readonly string[]) => {
      decoded.push(...vins);
      expect(vins.length).toBeLessThanOrEqual(50);
      return decode(vins);
    };
    let cursor = getDurableSourceDefinition("hollanderstores").initialCursor;
    for (let step = 0; step < 30; step++) {
      const result = await Effect.runPromise(
        streamHollanderstoresInventory({
          startCursor: cursor,
          maxPages: 1,
          readPage,
          decodeBatch,
          onBatch,
        }),
      );
      const serialized = serializeDurableSourceCursor(result.cursor);
      const resumed = parseDurableSourceCursor("hollanderstores", serialized);
      if (resumed.source !== "hollanderstores")
        throw new Error("Wrong durable source");
      cursor = resumed;
      if (result.status === "complete") {
        expect(result.count).toBe(876);
        break;
      }
      expect(batches).toHaveLength(0);
      expect(result.accounting.recordsProcessed).toBe(0);
    }
    expect(cursor.phase).toBe("complete");
    expect(calls).toEqual(
      [...HOLLANDERSTORES_YARDS, ...HOLLANDERSTORES_YARDS].map((y) => y.code),
    );
    expect(new Set(decoded).size).toBe(decoded.length);
    expect(decoded.length).toBeGreaterThan(200);
    expect(batches).toHaveLength(1);
    const terminal = await Effect.runPromise(
      streamHollanderstoresInventory({
        startCursor: cursor,
        readPage,
        decodeBatch,
        onBatch,
      }),
    );
    expect(terminal.count).toBe(0);
    expect(calls).toHaveLength(10);
    expect(batches).toHaveLength(1);
    expect(IngestionSourceFlags.resolve({})).not.toContain("hollanderstores");
  });
  test("closing drift and corrupt checkpoints cannot emit", async () => {
    let requests = 0,
      emitted = false;
    const run = streamHollanderstoresInventory({
      maxPages: 8,
      decodeBatch: decode,
      onBatch: () =>
        Effect.sync(() => {
          emitted = true;
        }),
      readPage: (yard) =>
        Effect.sync(() => {
          requests++;
          return fixture(yard.code);
        }),
    });
    const first = await Effect.runPromise(run);
    const checked = HollanderstoresCursor.parse(first.cursor);
    expect(() =>
      HollanderstoresCursor.parse({ ...checked, requests: 99 }),
    ).toThrow();
    const result = await Effect.runPromiseExit(
      streamHollanderstoresInventory({
        startCursor: first.cursor,
        maxPages: 8,
        decodeBatch: decode,
        onBatch: () =>
          Effect.sync(() => {
            emitted = true;
          }),
        readPage: (yard) =>
          Effect.succeed(fixture(yard.code).replace("A18031", "OTHER")),
      }),
    );
    expect(result._tag).toBe("Failure");
    expect(emitted).toBe(false);
    expect(requests).toBe(5);
  });
  test("provider failures never release partial inventory", async () => {
    let emitted = false;
    const result = await Effect.runPromiseExit(
      streamHollanderstoresInventory({
        decodeBatch: decode,
        onBatch: () =>
          Effect.sync(() => {
            emitted = true;
          }),
        readPage: () =>
          Effect.fail(
            new HollanderstoresProviderError({
              operation: "test",
              cause: "blocked",
            }),
          ),
      }),
    );
    expect(result._tag).toBe("Failure");
    expect(emitted).toBe(false);
  });
});

test("missing-make lookups use normalized VINs for decoding and row assessment", () => {
  const modified = pages();
  const row = modified[0]?.rows.find(
    (row) => row.make === null && hollanderstoresVin(row.vin),
  );
  if (!row) throw new Error("Missing valid blank-make fixture row");
  const normalized = row.vin.toUpperCase();
  row.vin = row.vin.toLowerCase();
  expect(hollanderstoresMissing({ pages: modified })).toContain(normalized);
  expect(hollanderstoresMissing({ pages: modified })).not.toContain(row.vin);
  const snapshot = hollanderstoresSnapshot(modified, hollanderstoresSeed);
  expect(snapshot.vehicles.some((v) => v.vin === normalized)).toBe(true);
  expect(snapshot.errors).toEqual([]);
});
test.each([
  ["ASTON MARTIN DB9", "ASTON MARTIN", "DB9"],
  ["ROLLS ROYCE PHANTOM", "ROLLS ROYCE", "PHANTOM"],
  ["LAND ROVER DISCOVERY", "LAND ROVER", "DISCOVERY"],
])("matches the complete known make prefix in %s", (heading, make, model) => {
  const raw = fixture("leblancsauto").replace("AMERICAN MOTORS H3", heading);
  const row = parseHollanderstoresPage(raw, 0).rows.find(
    (r) => r.vin === "5GTEN13E788122266",
  );
  expect(row).toMatchObject({ make, model });
});
test("unknown native make prefixes reject one row without publishing a guessed make", () => {
  const modified = pages();
  modified[0] = parseHollanderstoresPage(
    fixture("leblancsauto").replace(
      "AMERICAN MOTORS H3",
      "UNLISTED BRAND MODEL",
    ),
    0,
  );
  const snapshot = hollanderstoresSnapshot(modified, hollanderstoresSeed);
  expect(snapshot.vehicles.some((r) => r.vin === "5GTEN13E788122266")).toBe(
    false,
  );
  expect(snapshot.accounting.recordsRejected).toBe(9);
  expect(snapshot.errors).toEqual([]);
});
