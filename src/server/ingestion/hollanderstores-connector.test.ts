import { describe, expect, test } from "bun:test";
import { Cause, Effect, Exit, Option } from "effect";
import { validationRejectionKind } from "./ingestion-validation";
import {
  streamHollanderstoresInventory,
  type HollanderstoresStreamResult,
} from "./hollanderstores-connector";
import { streamHollanderstoresDurableInventory } from "./hollanderstores-durable";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";
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

import {
  hollanderstoresExpected as expected,
  hollanderstoresFixture as fixture,
  hollanderstoresFixturePages as pages,
} from "./hollanderstores-test-fixtures";
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
    expect(value.perYard).toEqual(expected.perYard);
    expect(value.vehicles).toHaveLength(expected.count);
    expect(
      value.vehicles.find((row) => row.vin === "5GTEN13E788122266")?.make,
    ).toBe("AMC");
    expect(
      value.warnings.some((message) => message.includes("NHTSA HUMMER")),
    ).toBe(true);
    expect(
      value.warnings.some((message) => message.includes("NHTSA DODGE")),
    ).toBe(true);
    expect(value.warnings.some((message) => message.includes("ALFA"))).toBe(
      false,
    );
    expect(value.observedVins).toHaveLength(expected.observedVins.length);
  }, 30_000);
  test("rejects failed make lookups without inventing a make and guards each yard", () => {
    const value = hollanderstoresSnapshot(pages(), {});
    // A yard failing its own guard is preserved; the others still publish.
    expect(value.errors).toEqual([]);
    const leblanc = value.rejectedYards.find(
      (yard) => yard.code === "leblancsauto",
    );
    expect(leblanc?.reason).toContain(
      "LeBlanc's Auto rejection ratio exceeds 10%",
    );
    expect(leblanc?.reason).toContain("previously published inventory");
    expect(
      value.vehicles.some((vehicle) => vehicle.locationCode === "leblancsauto"),
    ).toBe(false);
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
    const standardRejected = hollanderstoresSnapshot(
      failing,
      hollanderstoresSeed,
    );
    expect(standardRejected.errors).toEqual([]);
    expect(standardRejected.rejectedYards.map((yard) => yard.code)).toEqual([
      "standardauto",
    ]);
    expect(standardRejected.rejectedYards[0]?.reason).toContain(
      "Standard Used Auto Parts & Wrecking rejection ratio exceeds 10%",
    );
    // Its rows are read but excluded, so they cannot look like duplicates.
    const standardRows = failing[2]?.rows.length ?? 0;
    expect(standardRejected.accounting.recordsExcluded).toBe(standardRows);
    expect(
      standardRejected.vehicles.some(
        (vehicle) => vehicle.locationCode === "standardauto",
      ),
    ).toBe(false);
    expect(
      hollanderstoresSnapshot(pages(), hollanderstoresSeed, expected.count * 3)
        .errors,
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
        return fixture(
          yard.code +
            (calls.length > HOLLANDERSTORES_YARDS.length ? "-closing" : ""),
        );
      });
    const decodeBatch = (vins: readonly string[]) => {
      decoded.push(...vins);
      expect(vins.length).toBeLessThanOrEqual(50);
      return decode(vins);
    };
    const store = IngestionSnapshotStore.memory();
    const loadState = async (path: string) =>
      (await store.load(path)).checkpointState;
    let cursor = getDurableSourceDefinition("hollanderstores").initialCursor;
    for (let step = 0; step < 1000; step++) {
      const result = await Effect.runPromise(
        streamHollanderstoresDurableInventory(
          {
            startCursor: cursor,
            loadState,
            maxPages: 8,
            readPage,
            onBatch,
          },
          (options) =>
            streamHollanderstoresInventory({ ...options, decodeBatch }),
        ),
      );
      const statePath = await store.put({
        runId: "offline",
        source: "hollanderstores",
        chunk: {
          vehicles: [],
          observedVins: [],
          checkpointState: result.checkpointState,
        },
      });
      const persisted = { ...result.cursor, statePath };
      const serialized = serializeDurableSourceCursor(persisted);
      expect(Buffer.byteLength(serialized)).toBeLessThan(2048);
      expect(
        Buffer.byteLength(
          JSON.stringify({
            cursor: persisted,
            status: result.status,
            count: result.count,
            pagesProcessed: result.pagesProcessed,
            errors: result.errors,
          }),
        ),
      ).toBeLessThan(2048);
      const resumed = parseDurableSourceCursor("hollanderstores", serialized);
      if (resumed.source !== "hollanderstores")
        throw new Error("Wrong durable source");
      cursor = resumed;
      if (result.status === "complete") {
        expect(result.count).toBe(expected.count);
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
      streamHollanderstoresDurableInventory(
        {
          startCursor: cursor,
          loadState,
          readPage,
          onBatch,
        },
        (options) =>
          streamHollanderstoresInventory({ ...options, decodeBatch }),
      ),
    );
    expect(terminal.count).toBe(0);
    expect(calls).toHaveLength(2 * HOLLANDERSTORES_YARDS.length);
    expect(batches).toHaveLength(1);
    expect(IngestionSourceFlags.resolve({})).toContain("hollanderstores");
  }, 600_000);
  test("closing drift preserves only its yard, a census with no publishing yard fails, and corrupt checkpoints cannot emit", async () => {
    let requests = 0,
      emitted = false;
    const response = (yard: HollanderstoresYard) => {
      // Standard's saved stock A18031 retains the field-drift proof. The other
      // yards need only matching opening/closing bodies and cursor membership.
      if (yard.code === "standardauto") return fixture(yard.code);
      return `<html><body><a class="hpdcLogo">${yard.logo.replaceAll("&", "&amp;")}</a>
          <p>Showing 1 Vehicles in Inventory</p><div class="individualPartHolder">
          <span>&#39;13 ACURA RDX</span><li>VIN 5J8TB4H35DL015046</li><li>Stock# offline</li>
          <a href="/VehicleDealerShowParts/${yard.tenant}/1">View Parts</a></div></body></html>`;
    };
    const readPage = (yard: HollanderstoresYard) =>
      Effect.sync(() => {
        requests++;
        return response(yard);
      });
    const run = streamHollanderstoresInventory({
      maxPages: 8,
      decodeBatch: decode,
      onBatch: () =>
        Effect.sync(() => {
          emitted = true;
        }),
      readPage,
    });
    let first = await Effect.runPromise(run);
    while (first.cursor.phase !== "closing") {
      const remaining =
        first.cursor.phase === "opening"
          ? HOLLANDERSTORES_YARDS.length - first.cursor.pages.length
          : Math.ceil(
              (hollanderstoresMissing(first.cursor).length -
                Object.keys(first.cursor.decoded).length) /
                50,
            );
      first = await Effect.runPromise(
        streamHollanderstoresInventory({
          startCursor: first.cursor,
          maxPages: Math.min(8, remaining),
          decodeBatch: decode,
          readPage,
          onBatch: () => Effect.die("No inventory before closing"),
        }),
      );
    }
    const checked = HollanderstoresCursor.parse(first.cursor);
    expect(() =>
      HollanderstoresCursor.parse({ ...checked, requests: 99 }),
    ).toThrow();
    // Standard's closing census drifts, so it is preserved, and the closing
    // census goes on through the remaining yards. The one-card yards miss
    // their floors, so no yard publishes and the source fails unemitted.
    let cursor: HollanderstoresCursor = first.cursor;
    let closingReads = 0;
    for (;;) {
      const exit: Exit.Exit<
        HollanderstoresStreamResult,
        HollanderstoresProviderError
      > = await Effect.runPromiseExit(
        streamHollanderstoresInventory({
          startCursor: cursor,
          maxPages: 8,
          decodeBatch: decode,
          onBatch: () =>
            Effect.sync(() => {
              emitted = true;
            }),
          readPage: (yard) =>
            Effect.sync(() => {
              closingReads++;
              return response(yard).replace("A18031", "OTHER");
            }),
        }),
      );
      if (Exit.isSuccess(exit)) {
        expect(exit.value.status).toBe("paused");
        cursor = exit.value.cursor;
        continue;
      }
      const error = Cause.failureOption(exit.cause);
      if (Option.isNone(error)) throw new Error("Expected a rejection");
      expect(validationRejectionKind(error.value)).toBe("deterministic");
      expect(String(error.value)).toContain("every yard");
      expect(String(error.value)).toContain(
        "standardauto closing census changed surviving vehicle fields",
      );
      break;
    }
    expect(emitted).toBe(false);
    expect(requests).toBe(HOLLANDERSTORES_YARDS.length);
    expect(closingReads).toBe(HOLLANDERSTORES_YARDS.length);
  }, 600_000);
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

    // Invalid decoder values must stop inside a chunk, before another request.
    // Each yard needs one saved row to validate the cursor, not the full census.
    const minimal = HOLLANDERSTORES_YARDS.map((yard) => ({
      yard: yard.code,
      total: 1,
      rows: [
        {
          displayYear: "'13",
          make: null,
          model: "RDX",
          stock: "offline",
          vin: "5J8TB4H35DL015046",
          url: `${yard.websiteUrl}VehicleDealerShowParts/${yard.tenant}/1`,
        },
      ],
    }));
    const { checksum, ...initial } = HollanderstoresCursor.initial();
    expect(checksum).toBeString();
    const decoding = HollanderstoresCursor.checkpoint({
      ...initial,
      phase: "decoding",
      startedAt: Date.now(),
      pages: minimal,
      requests: minimal.length,
    });
    for (const make of ["", " ", "x".repeat(101)]) {
      let decodes = 0;
      const invalid = await Effect.runPromiseExit(
        streamHollanderstoresInventory({
          startCursor: decoding,
          maxPages: 8,
          decodeBatch: (vins) => {
            decodes++;
            return Effect.succeed(
              Object.fromEntries(vins.map((vin) => [vin, make])),
            );
          },
          readPage: () =>
            Effect.die("Invalid decoding must stop before closing"),
          onBatch: () => Effect.die("Invalid decoding cannot publish"),
        }),
      );
      expect(invalid._tag).toBe("Failure");
      expect(decodes).toBe(1);
    }
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
  expect(snapshot.accounting.recordsRejected).toBe(
    expected.perYard.reduce((sum, yard) => sum + yard.rejected, 0) + 1,
  );
  expect(snapshot.errors).toEqual([]);
});
