import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { createHash } from "node:crypto";
import { Effect } from "effect";
import { z } from "zod";
import { HarrysCursor } from "./harrys-cursor";
import { streamHarrysInventory } from "./harrys-connector";
import { HarrysProviderError } from "./harrys-client";
import { parseHarrysPage } from "./harrys-parser";
import { harrysSnapshot, validateHarrysSnapshot } from "./harrys-transform";
import { HARRYS_MINIMUM, HARRYS_MINIMUM_BY_YARD } from "./harrys-yard-metadata";
import { inventoryVinWithCheckDigit } from "./inventory-vin-check-digit";
import {
  newestVehicleArrival,
  validateSourceSnapshot,
} from "./source-validation";
import type { CanonicalVehicle } from "./types";

const receipts = z
  .array(
    z.object({
      url: z.string(),
      raw: z.string(),
      sha256: z.string(),
    }),
  )
  .parse(
    JSON.parse(
      brotliDecompressSync(
        readFileSync(
          new URL("./harrys-test-fixtures/native.json.br", import.meta.url),
        ),
      ).toString(),
    ),
  );

async function replay(change?: (raw: string, index: number) => string) {
  let cursor = HarrysCursor.initial(),
    index = 0,
    maxBytes = 0;
  const vehicles: CanonicalVehicle[] = [];
  const yards: string[] = [];
  let accounting = {
    recordsProcessed: 0,
    recordsRejected: 0,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  };
  while (cursor.phase !== "complete") {
    const result = await Effect.runPromise(
      streamHarrysInventory({
        startCursor: cursor,
        maxPages: 8,
        readPage: (url) =>
          Effect.try({
            try: () => {
              const receipt = receipts[index];
              if (!receipt || receipt.url !== url)
                throw new Error(`Unexpected offline request ${index}: ${url}`);
              expect(
                createHash("sha256").update(receipt.raw).digest("hex"),
              ).toBe(receipt.sha256);
              const raw = change ? change(receipt.raw, index) : receipt.raw;
              index++;
              return raw;
            },
            catch: (cause) =>
              new HarrysProviderError("offline fixture replay", cause),
          }),
        onBatch: (batch) =>
          Effect.sync(() => {
            vehicles.push(...batch);
          }),
        onYards: (batch) =>
          Effect.sync(() => {
            yards.push(...batch.map((y) => y.code));
          }),
      }),
    );
    const wire = HarrysCursor.serialize(result.cursor);
    maxBytes = Math.max(maxBytes, Buffer.byteLength(wire));
    cursor = HarrysCursor.fromWire(wire);
    accounting = result.accounting;
    if (result.status === "paused") {
      expect(vehicles).toHaveLength(0);
      expect(yards).toHaveLength(0);
      expect(result.count).toBe(0);
    }
  }
  const terminal = await Effect.runPromise(
    streamHarrysInventory({
      startCursor: cursor,
      readPage: () => {
        throw new Error("Terminal cursor requested a page");
      },
      onBatch: () => {
        throw new Error("Terminal cursor emitted vehicles");
      },
      onYards: () => {
        throw new Error("Terminal cursor emitted yards");
      },
    }),
  );
  expect(terminal.pagesProcessed).toBe(0);
  return { vehicles, yards, index, maxBytes, accounting };
}

test("Harry's replays separately acquired complete opening and closing censuses through durable resumes without network", async () => {
  const r = await replay();
  expect(r.index).toBe(574);
  expect(r.maxBytes).toBeLessThan(750_000);
  expect(r.vehicles).toHaveLength(4105);
  expect(r.yards).toEqual(["allentown", "hazle-township", "pennsburg"]);
  expect(new Set(r.vehicles.map((v) => v.vin)).size).toBe(4105);
  expect(r.accounting).toEqual({
    recordsProcessed: 4283,
    recordsRejected: 177,
    recordsExcluded: 0,
    duplicateVehicles: 1,
  });
  expect(
    r.yards.map(
      (yard) => r.vehicles.filter((v) => v.locationCode === yard).length,
    ),
  ).toEqual([535, 2727, 843]);
  for (const v of r.vehicles)
    expect(inventoryVinWithCheckDigit(v.vin, String(v.year))).toBe(v.vin);
  expect(
    validateSourceSnapshot({
      source: "harrys",
      terminal: true,
      uniqueVehicles: r.vehicles.length,
      vehiclesProcessed: r.accounting.recordsProcessed,
      rejectedVehicles: r.accounting.recordsRejected,
      duplicateVehicles: 1,
      errors: [],
      previousAcceptedCount: null,
      newestVehicleDate: newestVehicleArrival(
        r.vehicles,
        new Date("2026-11-16"),
      ),
      validatedAt: new Date("2026-11-16"),
    }).status,
  ).toBe("accepted");
}, 15_000);

test("Harry's rejects closing donor drift before any callbacks", async () => {
  await expect(
    replay((raw, index) =>
      index === 287
        ? raw.replace("1C3CCCAB7FN746659", "1C3CCCAB0FN746659")
        : raw,
    ),
  ).rejects.toThrow("Closing census changed");
});

const openingRecords = receipts
  .slice(1, 287)
  .flatMap((receipt, index) => parseHarrysPage(receipt.raw, index).records);

test("Harry's rejects all saved 1901 placeholders, including modern VINs and old serials", () => {
  const placeholders = openingRecords.filter(
    (record) => record.year === "1901",
  );
  expect(placeholders).toHaveLength(18);
  for (const vin of [
    "1FAHP35N88W198703",
    "1940PACKARD",
    "1941PLYMUTH",
    "1940CHEVY",
  ])
    expect(placeholders.some((record) => record.vin === vin)).toBe(true);
  const snapshot = harrysSnapshot(placeholders);
  expect(snapshot.vehicles).toHaveLength(0);
  expect(snapshot.accounting.recordsRejected).toBe(18);
  expect(snapshot.rejectedIds.size).toBe(18);
  expect(snapshot.observedVins).toContain("1FAHP35N88W198703");
});

test("Harry's admits roughly one third of each yard census and rejects a yard below its floor", () => {
  const snapshot = harrysSnapshot(openingRecords);
  const accepted = new Set(snapshot.vehicles.map((vehicle) => vehicle.vin));
  const unique = [
    ...new Map(
      openingRecords
        .filter((record) => accepted.has(record.vin))
        .map((record) => [record.vin, record]),
    ).values(),
  ];
  const minimum = [...HARRYS_MINIMUM_BY_YARD].flatMap(([code, floor]) => {
    const yard = snapshot.vehicles.find(
      (vehicle) => vehicle.locationCode === code,
    );
    if (!yard) throw new Error("Missing saved Harry's yard " + code);
    return unique
      .filter((record) => record.yard === yard.locationCity.toUpperCase())
      .slice(0, floor);
  });
  expect(minimum).toHaveLength(HARRYS_MINIMUM);
  expect([...HARRYS_MINIMUM_BY_YARD.values()]).toEqual([178, 909, 281]);
  expect(() =>
    validateHarrysSnapshot(harrysSnapshot(minimum), minimum),
  ).not.toThrow();
  for (const [code] of HARRYS_MINIMUM_BY_YARD) {
    const yard = snapshot.vehicles.find(
      (vehicle) => vehicle.locationCode === code,
    );
    if (!yard) throw new Error("Missing saved Harry's yard " + code);
    const removed = minimum.find(
      (record) => record.yard === yard.locationCity.toUpperCase(),
    );
    const replacement = unique.find(
      (record) =>
        record.yard !== yard.locationCity.toUpperCase() &&
        !minimum.includes(record),
    );
    if (!removed || !replacement)
      throw new Error("Missing floor boundary fixture donors");
    const below = minimum
      .filter((record) => record !== removed)
      .concat(replacement);
    expect(() => validateHarrysSnapshot(harrysSnapshot(below), below)).toThrow(
      code,
    );
  }
});
