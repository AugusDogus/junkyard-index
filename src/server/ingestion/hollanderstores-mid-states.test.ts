import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { hollanderstoresSeed } from "./hollanderstores-client";
import { hollanderstoresCensusError } from "./hollanderstores-census";
import { parseHollanderstoresPage } from "./hollanderstores-parser";
import { hollanderstoresSnapshot } from "./hollanderstores-snapshot";
import {
  hollanderstoresExpected,
  hollanderstoresFixtureBody as body,
  hollanderstoresFixtureBytes as bytes,
  hollanderstoresFixturePages,
} from "./hollanderstores-test-fixtures";
import { HOLLANDERSTORES_YARDS } from "./hollanderstores-yard-metadata";
import { IngestionSourceFlags } from "./ingestion-source-flags";
import { hollanderstoresVin } from "./hollanderstores-vin";

const additions = [
  {
    code: "rowlanut",
    total: 3844,
    accepted: 3797,
    rejected: 47,
    minimum: 1265,
    newestRecord: 72_810_154,
    newestVin: "JN8AT2MV4HW026823",
  },
  {
    code: "allsmallauto",
    total: 1186,
    accepted: 1174,
    rejected: 12,
    minimum: 391,
    newestRecord: 72_693_075,
    newestVin: "JF2GUADC0R8278250",
  },
];
const root = `${import.meta.dir}/hollanderstores-test-fixtures/mid-states/`;
const receipts = z
  .array(
    z.object({
      url: z.string().url(),
      file: z.string(),
      status: z.literal(200),
      bytes: z.number().int().positive(),
      sha256: z.string(),
      data: z.record(z.string()).nullable(),
      capturedAt: z.string().datetime({ offset: true }),
      completedAt: z.string().datetime({ offset: true }),
    }),
  )
  .parse(JSON.parse(readFileSync(root + "requests.json", "utf8")));

test("new Utah businesses retain complete, independently closed inventories", () => {
  const pages = hollanderstoresFixturePages();
  const snapshot = hollanderstoresSnapshot(pages, hollanderstoresSeed);
  expect(snapshot.errors).toEqual([]);
  expect(snapshot.perYard).toEqual(hollanderstoresExpected.perYard);
  expect(snapshot.vehicles).toHaveLength(hollanderstoresExpected.count);
  expect(snapshot.observedVins).toEqual(hollanderstoresExpected.observedVins);
  for (const {
    code,
    total,
    accepted,
    rejected,
    minimum,
    newestRecord,
    newestVin,
  } of additions) {
    const index = HOLLANDERSTORES_YARDS.findIndex((yard) => yard.code === code);
    const yard = HOLLANDERSTORES_YARDS[index];
    const page = pages[index];
    if (!yard || !page) throw new Error(`Missing qualified Utah yard ${code}`);
    const closing = parseHollanderstoresPage(
      body(`${code}-closing.html.gz`),
      index,
    );
    expect(hollanderstoresCensusError(page, closing)).toBeNull();
    expect(page.total).toBe(total);
    expect(new Set(page.rows.map((row) => row.url)).size).toBe(total);
    expect(
      Math.max(...page.rows.map((row) => Number(row.url.split("/").at(-1)))),
    ).toBe(newestRecord);
    // Mack's retained October-stock reference is 72,660,508 (stock 261006).
    // Compare platform activity only; no native arrival date is available.
    expect(newestRecord).toBeGreaterThan(72_660_508);
    expect(snapshot.perYard.find((row) => row.code === code)).toEqual({
      code,
      total,
      accepted,
      rejected,
      duplicates: 0,
    });
    expect<number>(yard.minimum).toBe(minimum);
    expect(minimum).toBe(Math.floor(accepted / 3));
    const donors = snapshot.vehicles.filter(
      (vehicle) => vehicle.locationCode === code,
    );
    expect(donors).toHaveLength(accepted);
    expect(donors.some((vehicle) => vehicle.vin === newestVin)).toBe(true);
    expect(
      donors.every(
        (vehicle) =>
          vehicle.stateAbbr === "UT" &&
          vehicle.lat === yard.lat &&
          vehicle.lng === yard.lng,
      ),
    ).toBe(true);
    expect(
      donors.every((vehicle) =>
        vehicle.detailsUrl?.startsWith(
          `${yard.websiteUrl}VehicleDealerShowParts/${yard.tenant}/`,
        ),
      ),
    ).toBe(true);
    // Public record IDs establish recent platform activity, not arrival dates.
    expect(donors.every((vehicle) => vehicle.availableDate === null)).toBe(
      true,
    );
  }
  expect(IngestionSourceFlags.resolve({})).toContain("hollanderstores");
}, 120_000);

test("captured requests and VIN-to-make cache retain original provider evidence", () => {
  expect(receipts).toHaveLength(34);
  const audited = new Set<string>();
  const missingNativeMakes = new Set(
    hollanderstoresFixturePages().flatMap((page) =>
      additions.some(({ code }) => code === page.yard)
        ? page.rows.filter((row) => row.make === null).map((row) => row.vin)
        : [],
    ),
  );
  for (const receipt of receipts) {
    const raw = bytes(`mid-states/${receipt.file}`);
    expect(raw.byteLength).toBe(receipt.bytes);
    expect(createHash("sha256").update(raw).digest("hex")).toBe(receipt.sha256);
    if (receipt.url.includes("DecodeVINValuesBatch")) {
      const response = z
        .object({
          Results: z.array(
            z.object({ VIN: z.string(), Make: z.string().min(1) }),
          ),
        })
        .parse(JSON.parse(raw.toString()));
      const requested = receipt.data?.data?.split(";") ?? [];
      expect(requested.length).toBeLessThanOrEqual(50);
      expect(response.Results.map((row) => row.VIN).sort()).toEqual(
        [...requested].sort(),
      );
      for (const row of response.Results) {
        expect(hollanderstoresVin(row.VIN)).toBe(row.VIN);
        expect(audited.has(row.VIN)).toBe(false);
        audited.add(row.VIN);
        expect(hollanderstoresSeed[row.VIN]).toBe(row.Make);
        expect(missingNativeMakes.has(row.VIN)).toBe(true);
      }
    }
  }
  expect(audited.size).toBe(990);
});

test("replacement opening and closing acquisition is serial and spaced", () => {
  const serial = receipts.filter(
    (receipt) =>
      !receipt.file.includes("initial") &&
      receipt.url.endsWith("VehicleDealerSearch"),
  );
  expect(serial.map((receipt) => receipt.file)).toEqual([
    "rowlanut.html.gz",
    "allsmallauto.html.gz",
    "rowlanut-closing.html.gz",
    "allsmallauto-closing.html.gz",
  ]);
  for (let index = 1; index < serial.length; index++) {
    const previous = serial[index - 1];
    const next = serial[index];
    if (!previous || !next) throw new Error("Missing serial census receipt");
    expect(
      Date.parse(next.capturedAt) - Date.parse(previous.completedAt),
    ).toBeGreaterThanOrEqual(3_500);
  }
});

test.each(additions)(
  "$code owns its Census-matched physical location",
  ({ code }) => {
    const yard = HOLLANDERSTORES_YARDS.find((yard) => yard.code === code);
    if (!yard) throw new Error(`Missing qualified Utah yard ${code}`);
    const geocode = z
      .object({
        result: z.object({
          addressMatches: z
            .array(
              z.object({
                coordinates: z.object({ x: z.number(), y: z.number() }),
                addressComponents: z.object({
                  state: z.literal("UT"),
                  zip: z.string(),
                }),
              }),
            )
            .length(1),
        }),
      })
      .parse(JSON.parse(body(`${code}-geocode.json.gz`)));
    const match = geocode.result.addressMatches[0];
    expect(match?.coordinates).toEqual({ x: yard.lng, y: yard.lat });
    expect(match?.addressComponents.zip).toBe(yard.postalCode);
    if (code === "allsmallauto") {
      const owner = body("allsmallauto-owner.html.gz");
      expect(owner).toContain("72 East 8000 South");
      expect(owner).toContain(yard.websiteUrl + "VehicleDealerSearch");
    } else expect(body(`${code}-about.html.gz`)).toContain(yard.address);
  },
);
