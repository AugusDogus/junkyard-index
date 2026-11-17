import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { readBoundedResponseText } from "./ipullupull-response-text";
import { hollanderstoresBodyLimit } from "./hollanderstores-limits";
import { HOLLANDERSTORES_YARDS } from "./hollanderstores-yard-metadata";
import {
  hollanderstoresExpected,
  hollanderstoresFixtureBody,
  hollanderstoresFixturePages,
} from "./hollanderstores-test-fixtures";
import { hollanderstoresMissing } from "./hollanderstores-cursor";
import { hollanderstoresSeed } from "./hollanderstores-client";
import { hollanderstoresSnapshot } from "./hollanderstores-snapshot";
import { IngestionSourceFlags } from "./ingestion-source-flags";
import { beaversText } from "./beavers-html";
import { stripInventoryRawText } from "./inventory-html";
import { parseHollanderstoresRoster } from "./hollanderstores-parser";
import { hollanderstoresVin } from "./hollanderstores-vin";

const root = `${import.meta.dir}/hollanderstores-test-fixtures/stricker/`;
const yard = HOLLANDERSTORES_YARDS.find((yard) => yard.code === "strickerauto");
if (!yard) throw new Error("Missing qualified Stricker yard");
const read = (file: string): unknown =>
  JSON.parse(readFileSync(root + file, "utf8"));

test("Stricker alone has a 50 MiB transport and parser bound with complete-body cancellation", async () => {
  expect(hollanderstoresBodyLimit(yard.code)).toBe(50 * 1024 * 1024);
  expect(hollanderstoresBodyLimit("leblancsauto")).toBe(40 * 1024 * 1024);
  const raw = hollanderstoresFixtureBody("strickerauto.html.gz");
  expect(() =>
    parseHollanderstoresRoster(raw, { ...yard, code: "unqualified" }),
  ).toThrow("body bound");
  const excessive = new Uint8Array(hollanderstoresBodyLimit(yard.code) + 1);
  expect(() =>
    parseHollanderstoresRoster(" ".repeat(excessive.length), yard),
  ).toThrow("body bound");
  let cancelled = false;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(excessive);
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  await expect(
    readBoundedResponseText(
      response,
      "Stricker",
      AbortSignal.timeout(10_000),
      hollanderstoresBodyLimit(yard.code),
    ),
  ).rejects.toThrow("exceeds 50 MiB");
  expect(cancelled).toBe(true);
});

test("Stricker ships enabled with a census-derived floor, check-digit VINs and native destinations", () => {
  const snapshot = hollanderstoresSnapshot(
    hollanderstoresFixturePages(),
    hollanderstoresSeed,
  );
  const tally = snapshot.perYard.find((row) => row.code === yard.code);
  if (!tally) throw new Error("Missing Stricker qualification tally");
  expect(snapshot.errors).toEqual([]);
  const expected = hollanderstoresExpected.perYard.find(
    (row) => row.code === yard.code,
  );
  if (!expected) throw new Error("Missing frozen Stricker qualification");
  expect(tally).toEqual(expected);
  expect(tally.total).toBe(12456);
  expect(tally.rejected / tally.total).toBeLessThan(0.1);
  expect(Math.floor(tally.accepted / 3)).toBe(yard.minimum);
  expect(IngestionSourceFlags.resolve({})).toContain("hollanderstores");
  const vehicles = snapshot.vehicles.filter(
    (row) => row.locationCode === yard.code,
  );
  expect(vehicles).toHaveLength(tally.accepted);
  for (const vehicle of vehicles) {
    expect(hollanderstoresVin(vehicle.vin)).toBe(vehicle.vin);
    expect(vehicle.detailsUrl).toStartWith(
      yard.websiteUrl + "VehicleDealerShowParts/2364/",
    );
    expect([vehicle.lat, vehicle.lng, vehicle.stateAbbr]).toEqual([
      yard.lat,
      yard.lng,
      "OH",
    ]);
  }
}, 30000);

test("Stricker physical point matches its published address and Census street range", () => {
  const response = z
    .object({
      result: z.object({
        addressMatches: z
          .array(
            z.object({
              matchedAddress: z.string(),
              coordinates: z.object({ x: z.number(), y: z.number() }),
            }),
          )
          .length(1),
      }),
    })
    .parse(JSON.parse(hollanderstoresFixtureBody("stricker/geocode.json.gz")));
  expect(response.result.addressMatches[0]).toEqual({
    matchedAddress: "4955 BENTON RD, BATAVIA, OH, 45103",
    coordinates: { x: yard.lng, y: yard.lat },
  });
  expect(
    beaversText(
      stripInventoryRawText(
        hollanderstoresFixtureBody("strickerauto-about.html.gz"),
      ),
    ),
  ).toContain("4955 Benton Rd. Batavia, OH 45103");
});

test("Stricker decode fixtures reconcile every new missing-make VIN and exact response bytes", () => {
  const receipts = z
    .array(
      z.object({
        file: z.string(),
        vins: z.array(z.string()).min(1).max(50),
        bytes: z.number(),
        sha256: z.string(),
        startedAt: z.string().datetime({ offset: true }),
        completedAt: z.string().datetime({ offset: true }),
        status: z.literal(200),
      }),
    )
    .parse(read("requests.json"));
  const needed = new Set(
    hollanderstoresMissing({
      pages: hollanderstoresFixturePages().filter(
        (page) => page.yard === yard.code,
      ),
    }),
  );
  const audited = new Set<string>();
  for (const [index, receipt] of receipts.entries()) {
    const previous = receipts[index - 1];
    if (previous)
      expect(
        Date.parse(receipt.startedAt) - Date.parse(previous.completedAt),
      ).toBeGreaterThanOrEqual(3000);
    const raw = gunzipSync(readFileSync(root + receipt.file));
    expect(raw.byteLength).toBe(receipt.bytes);
    expect(createHash("sha256").update(raw).digest("hex")).toBe(receipt.sha256);
    const response = z
      .object({
        Count: z.number(),
        Results: z.array(
          z.object({ VIN: z.string(), Make: z.string().nullable() }),
        ),
      })
      .parse(JSON.parse(raw.toString("utf8")));
    expect(response.Count).toBe(receipt.vins.length);
    expect(response.Results.map((row) => row.VIN).sort()).toEqual(
      [...receipt.vins].sort(),
    );
    for (const row of response.Results) {
      expect(needed.has(row.VIN)).toBe(true);
      expect(audited.has(row.VIN)).toBe(false);
      audited.add(row.VIN);
      if (row.Make?.trim()) expect(hollanderstoresSeed[row.VIN]).toBe(row.Make);
    }
  }
  expect(receipts).toHaveLength(75);
  expect(audited.size).toBe(3736);
});
