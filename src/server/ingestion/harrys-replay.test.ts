import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { createHash } from "node:crypto";
import { Effect } from "effect";
import { z } from "zod";
import { HarrysCursor } from "./harrys-cursor";
import { streamHarrysInventory } from "./harrys-connector";
import { HarrysProviderError } from "./harrys-client";
import { inventoryVinWithCheckDigit } from "./inventory-vin-check-digit";
import { validateSourceSnapshot } from "./source-validation";
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
  expect(r.vehicles).toHaveLength(4122);
  expect(r.yards).toEqual(["allentown", "hazle-township", "pennsburg"]);
  expect(new Set(r.vehicles.map((v) => v.vin)).size).toBe(4122);
  expect(r.accounting).toEqual({
    recordsProcessed: 4283,
    recordsRejected: 160,
    recordsExcluded: 0,
    duplicateVehicles: 1,
  });
  expect(
    r.yards.map(
      (yard) => r.vehicles.filter((v) => v.locationCode === yard).length,
    ),
  ).toEqual([535, 2741, 846]);
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
