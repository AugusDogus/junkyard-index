import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { beaversText } from "./beavers-html";
import { hollanderstoresCensusError } from "./hollanderstores-census";
import { hollanderstoresSeed } from "./hollanderstores-client";
import { parseHollanderstoresRoster } from "./hollanderstores-parser";
import { hollanderstoresSnapshot } from "./hollanderstores-snapshot";
import {
  hollanderstoresFixtureBody as body,
  hollanderstoresFixtureBytes as bytes,
  hollanderstoresFixturePages as pages,
} from "./hollanderstores-test-fixtures";
import { hollanderstoresVin } from "./hollanderstores-vin";
import { HOLLANDERSTORES_YARDS } from "./hollanderstores-yard-metadata";
import { IngestionSourceFlags } from "./ingestion-source-flags";
import { SourceValidationPolicy } from "./source-validation";

const additions = HOLLANDERSTORES_YARDS.filter((yard) =>
  ["florasauto", "tvilleauto"].includes(yard.code),
);
const root = `${import.meta.dir}/hollanderstores-test-fixtures/east/`;
const receipts = z
  .array(
    z.object({
      file: z.string(),
      url: z.string().url(),
      body: z.string().optional(),
      started: z.string().datetime({ offset: true }).optional(),
      ended: z.string().datetime({ offset: true }).optional(),
      status: z.literal(200),
      bytes: z.number().int().positive(),
      sha256: z.string(),
    }),
  )
  .parse(JSON.parse(readFileSync(root + "requests.json", "utf8")));

test("the east expansion registers two distinct businesses at physical yards", () => {
  expect(
    additions.map(({ code, state, address, minimum }) => ({
      code,
      state,
      address,
      minimum,
    })),
  ).toEqual([
    {
      code: "florasauto",
      state: "IN",
      address: "6233 N State Road 15",
      minimum: 193,
    },
    {
      code: "tvilleauto",
      state: "KY",
      address: "794 Radio Station Rd",
      minimum: 106,
    },
  ]);
});

test("complete opening and closing rosters accept 899 donors and preserve rejected identities", () => {
  const snapshot = hollanderstoresSnapshot(pages(), hollanderstoresSeed);
  expect(snapshot.errors).toEqual([]);
  expect(
    snapshot.perYard.filter((census) =>
      additions.some((yard) => yard.code === census.code),
    ),
  ).toEqual([
    {
      code: "florasauto",
      accepted: 581,
      rejected: 2,
      duplicates: 0,
      total: 583,
    },
    {
      code: "tvilleauto",
      accepted: 318,
      rejected: 1,
      duplicates: 0,
      total: 319,
    },
  ]);
  for (const yard of additions) {
    const opening = parseHollanderstoresRoster(
      body(yard.code + ".html.gz"),
      yard,
    );
    const closing = parseHollanderstoresRoster(
      body(yard.code + "-closing.html.gz"),
      yard,
    );
    expect(closing).toEqual(opening);
    expect(
      parseHollanderstoresRoster(body(yard.code + "-client.html.gz"), yard),
    ).toEqual(opening);
    expect(hollanderstoresCensusError(opening, closing)).toBeNull();
    const vehicles = snapshot.vehicles.filter(
      (row) => row.locationCode === yard.code,
    );
    expect(Math.floor(vehicles.length / 3)).toBe(yard.minimum);
    for (const vehicle of vehicles) {
      expect(hollanderstoresVin(vehicle.vin)).toBe(vehicle.vin);
      expect(vehicle).toMatchObject({
        locationName: yard.name,
        locationCity: yard.city,
        stateAbbr: yard.state,
        lat: yard.lat,
        lng: yard.lng,
        availableDate: null,
      });
      expect(vehicle.detailsUrl).toStartWith(
        yard.websiteUrl + "VehicleDealerShowParts/" + yard.tenant + "/",
      );
    }
  }
  for (const vin of [
    "5LM5J7XC5SGL31025",
    "SALRG2RV2K2401126",
    "KM8SC83S21U132552",
  ]) {
    expect(snapshot.vehicles.some((row) => row.vin === vin)).toBe(false);
    expect(snapshot.observedVins).toContain(vin);
  }
  expect(IngestionSourceFlags.resolve({})).toContain("hollanderstores");
  expect(SourceValidationPolicy.minimumUniqueInventory.hollanderstores).toBe(
    HOLLANDERSTORES_YARDS.reduce((sum, yard) => sum + yard.minimum, 0),
  );
}, 30000);

test("native part details bind recent acquisition dates to enumerated donors", () => {
  for (const control of [
    {
      code: "florasauto",
      vin: "2D4FV47V37H785448",
      stock: "610161",
      date: "11/16/2026",
    },
    {
      code: "tvilleauto",
      vin: "1GCCS136248164449",
      stock: "26T193",
      date: "10/26/2026",
    },
  ]) {
    const yard = additions.find((row) => row.code === control.code);
    if (!yard) throw new Error("Missing qualified east yard");
    const opening = parseHollanderstoresRoster(
      body(yard.code + ".html.gz"),
      yard,
    );
    expect(opening.rows).toContainEqual(
      expect.objectContaining({ vin: control.vin, stock: control.stock }),
    );
    const detail = beaversText(body(control.code + "-fresh-part.html.gz"));
    expect(detail).toContain("VIN " + control.vin);
    expect(detail).toContain("Stock # " + control.stock);
    expect(detail).toContain("Date Acquired " + control.date);
  }
});

test("physical addresses and Census points agree with the independent business sites", () => {
  for (const yard of additions) {
    const geocode = z
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
      .parse(JSON.parse(body(yard.code + "-geocode.json.gz")));
    const point = geocode.result.addressMatches[0];
    expect(point?.coordinates).toEqual({ x: yard.lng, y: yard.lat });
    expect(point?.matchedAddress).toContain(
      yard.state + ", " + yard.postalCode,
    );
  }
  expect(body("floras-operator.html.gz")).toContain("6233 North State Road 15");
  expect(body("tville-contact.html.gz")).toContain("794 Radio Station Rd.");
});

test("saved response receipts retain exact bytes and paced qualification requests", () => {
  let previousEnd: number | undefined;
  for (const receipt of receipts) {
    const raw = bytes("east/" + receipt.file + ".gz");
    expect(raw.byteLength).toBe(receipt.bytes);
    expect(createHash("sha256").update(raw).digest("hex")).toBe(receipt.sha256);
    if (receipt.started && receipt.ended) {
      if (previousEnd !== undefined)
        expect(
          Date.parse(receipt.started) - previousEnd,
        ).toBeGreaterThanOrEqual(3000);
      previousEnd = Date.parse(receipt.ended);
    }
  }
});

test("vPIC evidence decodes only valid missing native makes in exact batches", () => {
  const seen = new Set<string>();
  for (const receipt of receipts.filter((row) => row.file.includes("-vpic-"))) {
    if (!receipt.body) throw new Error("Missing vPIC request body");
    const vins =
      new URLSearchParams(receipt.body).get("data")?.split(";") ?? [];
    expect(vins.length).toBeGreaterThan(0);
    expect(vins.length).toBeLessThanOrEqual(50);
    const rows = additions.flatMap(
      (yard) =>
        parseHollanderstoresRoster(body(yard.code + ".html.gz"), yard).rows,
    );
    const response = z
      .object({
        Results: z.array(
          z.object({ VIN: z.string(), Make: z.string().min(1) }),
        ),
      })
      .parse(JSON.parse(body("east/" + receipt.file + ".gz")));
    expect(response.Results.map((row) => row.VIN).sort()).toEqual(
      [...vins].sort(),
    );
    for (const result of response.Results) {
      expect(seen.has(result.VIN)).toBe(false);
      seen.add(result.VIN);
      expect(hollanderstoresVin(result.VIN)).toBe(result.VIN);
      expect(
        rows.some((row) => row.vin === result.VIN && row.make === null),
      ).toBe(true);
      expect(hollanderstoresSeed[result.VIN]).toBe(result.Make);
    }
  }
  expect(seen.size).toBe(251);
}, 30000);
