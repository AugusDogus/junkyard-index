import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { Effect } from "effect";
import { z } from "zod";
import { streamIdipullInventoryWithRequestGate } from "./idipull-connector";
import { parseIdipullInventory } from "./idipull-parser";
import { inventoryVinWithCheckDigit } from "./inventory-vin-check-digit";
import {
  newestVehicleArrival,
  validateSourceSnapshot,
} from "./source-validation";
import { IDIPULL_YARD } from "./idipull-yard-metadata";
import type { IdipullCanonicalVehicle } from "./idipull-transform";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("Idaho Falls replays the complete fresh 568-stock census and independent closing read", async () => {
  const archive = z
    .object({
      asOf: z.string(),
      responses: z.array(
        z.object({
          url: z.string().url(),
          html: z.string(),
          sha256: z.string(),
          receipt: z.object({
            startedAt: z.number(),
            endedAt: z.number(),
            status: z.literal(200),
            exit: z.literal(0),
            sharedGate: z.literal(true),
          }),
        }),
      ),
    })
    .parse(
      JSON.parse(
        gunzipSync(
          readFileSync(
            new URL("./fixtures/idipull-census.json.gz", import.meta.url),
          ),
        ).toString(),
      ),
    );
  let reads = 0;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const saved = archive.responses[reads++];
      expect(saved?.url).toBe(
        input instanceof Request ? input.url : String(input),
      );
      if (!saved) throw new Error("Unexpected census replay request");
      expect(createHash("sha256").update(saved.html).digest("hex")).toBe(
        saved.sha256,
      );
      return new Response(saved.html, {
        headers: { "content-type": "text/html" },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  const vehicles: IdipullCanonicalVehicle[] = [];
  const result = await Effect.runPromise(
    streamIdipullInventoryWithRequestGate(
      {
        asOf: new Date(archive.asOf),
        onYards: (yards) =>
          Effect.sync(() => {
            expect(reads).toBe(3);
            expect(yards).toEqual([IDIPULL_YARD]);
          }),
        onBatch: (batch) =>
          Effect.sync(() => {
            expect(reads).toBe(3);
            vehicles.push(...batch);
          }),
      },
      (request) => request,
    ),
  );
  const opening = archive.responses[1];
  const closing = archive.responses[2];
  if (!opening || !closing)
    throw new Error("Missing independent inventory controls");
  expect(closing.receipt.startedAt).toBeGreaterThan(
    opening.receipt.endedAt + 3.1,
  );
  const rows = parseIdipullInventory(opening.html);
  expect(rows).toHaveLength(568);
  expect(new Set(rows.map((row) => row.stockNumber)).size).toBe(568);
  expect(new Set(rows.map((row) => row.vin)).size).toBe(565);
  expect(result).toMatchObject({
    count: 535,
    status: "complete",
    accounting: {
      recordsProcessed: 568,
      recordsExcluded: 0,
      recordsRejected: 33,
      duplicateVehicles: 0,
    },
  });
  expect(new Set(vehicles.map((vehicle) => vehicle.vin)).size).toBe(535);
  expect(
    vehicles.every(
      (vehicle) =>
        inventoryVinWithCheckDigit(vehicle.vin, String(vehicle.year)) !== null,
    ),
  ).toBe(true);
  expect(vehicles.some((vehicle) => vehicle.vin === "1GNDT13S422181887")).toBe(
    false,
  );
  expect(result.observedVins).toContain("1GNDT13S422181887");
  expect(result.observedVins).toContain("4T1BK36B06U116717");
  expect(
    vehicles
      .map((vehicle) => vehicle.availableDate)
      .filter((date) => date !== null)
      .sort()
      .at(-1),
  ).toBe("2026-11-13");
  expect(
    vehicles.every(
      (vehicle) =>
        vehicle.detailsUrl === "https://ifipull.com/inventory/" &&
        vehicle.lat === 43.523078 &&
        vehicle.lng === -112.006206,
    ),
  ).toBe(true);
  const validation = {
    source: "idipull",
    terminal: true,
    uniqueVehicles: result.count,
    vehiclesProcessed: 568,
    duplicateVehicles: 0,
    rejectedVehicles: 33,
    errors: [],
    previousAcceptedCount: null,
    newestVehicleDate: newestVehicleArrival(vehicles, new Date("2026-11-14")),
    validatedAt: new Date("2026-11-14"),
  } as const;
  expect(validateSourceSnapshot({ ...validation, errors: [] }).status).toBe(
    "accepted",
  );
  expect(
    validateSourceSnapshot({
      ...validation,
      errors: [],
      previousAcceptedCount: 1072,
    }).status,
  ).toBe("rejected");
  expect(reads).toBe(archive.responses.length);
});
