import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { HOLLANDERSTORES_YARDS } from "./hollanderstores-yard-metadata";
import {
  hollanderstoresFixtureBody as body,
  hollanderstoresFixtureBytes as bytes,
  hollanderstoresFixturePages as pages,
} from "./hollanderstores-test-fixtures";
import { parseHollanderstoresRoster } from "./hollanderstores-parser";
import { hollanderstoresCensusError } from "./hollanderstores-census";
import { hollanderstoresVin } from "./hollanderstores-vin";
import { hollanderstoresSnapshot } from "./hollanderstores-snapshot";
import { hollanderstoresSeed } from "./hollanderstores-client";
import { IngestionSourceFlags } from "./ingestion-source-flags";
import { SourceValidationPolicy } from "./source-validation";

const root = "midwest-west/";
const receipts = z
  .array(
    z.object({
      url: z.string().url(),
      method: z.enum(["GET", "POST"]),
      status: z.literal(200),
      started: z.number(),
      finished: z.number(),
      bytes: z.number().int().positive(),
      sha256: z.string(),
      file: z.string(),
      requestVins: z.array(z.string()).min(1).max(50).optional(),
    }),
  )
  .parse(
    JSON.parse(
      readFileSync(
        `${import.meta.dir}/hollanderstores-test-fixtures/${root}requests.json`,
        "utf8",
      ),
    ),
  );

for (const expected of [
  { code: "mwas", total: 224, newest: 72_702_019, state: "OK" },
  { code: "florasauto", total: 590, newest: 72_824_866, state: "IN" },
  { code: "hsaw", total: 33, newest: 72_770_928, state: "WA" },
] as const)
  test(`${expected.code} has a complete matching roster with recent platform activity`, () => {
    const yard = HOLLANDERSTORES_YARDS.find(
      (yard) => yard.code === expected.code,
    );
    expect(yard).toBeDefined();
    if (!yard)
      throw new Error(
        "Qualified Hollander yard is not configured: " + expected.code,
      );
    const opening = parseHollanderstoresRoster(
      body(root + expected.code + ".html.gz"),
      yard,
    );
    const closing = parseHollanderstoresRoster(
      body(root + expected.code + "-closing.html.gz"),
      yard,
    );
    expect(opening.total).toBe(expected.total);
    expect(hollanderstoresCensusError(opening, closing)).toBeNull();
    expect(
      opening.rows.every((row) => hollanderstoresVin(row.vin) === row.vin),
    ).toBe(true);
    const newest = Math.max(
      ...opening.rows.map((row) =>
        Number(new URL(row.url).pathname.split("/").at(-1)),
      ),
    );
    expect(newest).toBe(expected.newest);
    // Existing October-stock reference, not an inferred native arrival date.
    expect(newest).toBeGreaterThan(72_660_508);
    expect(yard.state).toBe(expected.state);
  });

test("new yards retain native models, preserve rejected identities and pass combined source validation", () => {
  const yard = HOLLANDERSTORES_YARDS.find((yard) => yard.code === "mwas");
  if (!yard) throw new Error("Midwest Auto Parts is not configured");
  const snapshot = hollanderstoresSnapshot(pages(), hollanderstoresSeed);
  expect(snapshot.errors).toEqual([]);
  expect(snapshot.perYard.find((yard) => yard.code === "mwas")).toEqual({
    code: "mwas",
    total: 224,
    accepted: 221,
    rejected: 3,
    duplicates: 0,
  });
  expect(snapshot.perYard.find((yard) => yard.code === "florasauto")).toEqual({
    code: "florasauto",
    total: 590,
    accepted: 588,
    rejected: 2,
    duplicates: 0,
  });
  expect(snapshot.perYard.find((yard) => yard.code === "hsaw")).toEqual({
    code: "hsaw",
    total: 33,
    accepted: 33,
    rejected: 0,
    duplicates: 0,
  });
  const vehicles = snapshot.vehicles.filter(
    (vehicle) => vehicle.locationCode === "mwas",
  );
  expect(vehicles).toHaveLength(221);
  expect(
    vehicles.every(
      (vehicle) =>
        vehicle.availableDate === null &&
        vehicle.stateAbbr === "OK" &&
        vehicle.detailsUrl?.startsWith(
          "https://mwas.hollanderstores.com/VehicleDealerShowParts/7342/",
        ),
    ),
  ).toBe(true);
  expect(
    vehicles.find((vehicle) => vehicle.vin === "2LMHJ5ATXDBL57521"),
  ).toMatchObject({
    year: 2013,
    make: "Lincoln",
    model: "MKT",
    stockNumber: "29168",
  });
  for (const vin of [
    "SALRG2RV8L2428056",
    "SALAK2D47AA523883",
    "SALAK2D41DA678319",
  ]) {
    expect(vehicles.some((vehicle) => vehicle.vin === vin)).toBe(false);
    expect(snapshot.observedVins).toContain(vin);
  }
  const flora = HOLLANDERSTORES_YARDS.find(
    (yard) => yard.code === "florasauto",
  );
  if (!flora) throw new Error("Flora's Auto Parts is not configured");
  const floraVehicles = snapshot.vehicles.filter(
    (vehicle) => vehicle.locationCode === flora.code,
  );
  expect(floraVehicles).toHaveLength(588);
  expect(
    floraVehicles.every(
      (vehicle) =>
        vehicle.availableDate === null &&
        vehicle.stateAbbr === "IN" &&
        vehicle.detailsUrl?.startsWith(
          "https://florasauto.hollanderstores.com/VehicleDealerShowParts/7176/",
        ),
    ),
  ).toBe(true);
  expect(
    floraVehicles.find((vehicle) => vehicle.vin === "2GCEK19R4V1197662"),
  ).toMatchObject({
    year: 1997,
    make: "Chevrolet",
    model: "TCHEV1500",
    stockNumber: "610168",
  });
  for (const vin of ["5LM5J7XC5SGL31025", "SALRG2RV2K2401126"]) {
    expect(floraVehicles.some((vehicle) => vehicle.vin === vin)).toBe(false);
    expect(snapshot.observedVins).toContain(vin);
  }
  expect(Math.floor(221 / 3)).toBe(yard.minimum);
  expect(Math.floor(588 / 3)).toBe(flora.minimum);
  const horseshoe = HOLLANDERSTORES_YARDS.find((yard) => yard.code === "hsaw");
  if (!horseshoe) throw new Error("Horseshoe Auto Wrecking is not configured");
  const horseshoeVehicles = snapshot.vehicles.filter(
    (vehicle) => vehicle.locationCode === horseshoe.code,
  );
  expect(horseshoeVehicles).toHaveLength(33);
  expect(
    horseshoeVehicles.every(
      (vehicle) =>
        vehicle.availableDate === null &&
        vehicle.stateAbbr === "WA" &&
        vehicle.detailsUrl?.startsWith(
          "https://hsaw.hollanderstores.com/VehicleDealerShowParts/6605/",
        ),
    ),
  ).toBe(true);
  expect(
    horseshoeVehicles.find((vehicle) => vehicle.vin === "KMHCN46C87U097213"),
  ).toMatchObject({
    year: 2007,
    make: "Hyundai",
    model: "ACCENT",
    stockNumber: "9652",
  });
  expect(Math.floor(33 / 3)).toBe(horseshoe.minimum);
  expect(SourceValidationPolicy.minimumUniqueInventory.hollanderstores).toBe(
    HOLLANDERSTORES_YARDS.reduce((sum, yard) => sum + yard.minimum, 0),
  );
  expect(IngestionSourceFlags.resolve({})).toContain("hollanderstores");
}, 30_000);

for (const expected of [
  {
    code: "mwas",
    address: "3815 N Lewis",
    matched: "3815 N LEWIS AVE, TULSA, OK, 74110",
    nativeLink: "mwas.hollanderstores.com/VehicleDealerSearch",
  },
  {
    code: "florasauto",
    address: "6233 N SR15",
    matched: "6233 N STATE RD 15, LEESBURG, IN, 46538",
    nativeLink: "florasauto.hollanderstores.com/used-auto-parts",
  },
  {
    code: "hsaw",
    address: "7360 State Highway 3 SW",
    matched: "7360 STATE HWY 3 SW, BREMERTON, WA, 98312",
    nativeLink: "hsaw.hollanderstores.com",
  },
])
  test(`${expected.code} address and coordinates match the native profile and Census response`, () => {
    const yard = HOLLANDERSTORES_YARDS.find(
      (yard) => yard.code === expected.code,
    );
    if (!yard)
      throw new Error(
        "Qualified Hollander yard is not configured: " + expected.code,
      );
    expect(body(root + expected.code + "-about.html.gz")).toContain(
      expected.address,
    );
    expect(body(root + expected.code + "-about.html.gz")).toContain(
      yard.postalCode,
    );
    expect(body(root + expected.code + "-native.html.gz")).toContain(
      expected.nativeLink,
    );
    const geocode = z
      .object({
        result: z.object({
          addressMatches: z
            .array(
              z.object({
                coordinates: z.object({ x: z.number(), y: z.number() }),
                matchedAddress: z.string(),
              }),
            )
            .length(1),
        }),
      })
      .parse(JSON.parse(body(root + expected.code + "-geocode.json.gz")));
    expect(geocode.result.addressMatches[0]).toEqual({
      coordinates: { x: yard.lng, y: yard.lat },
      matchedAddress: expected.matched,
    });
  });

test("new yard captures and make decodes replay exact receipt bytes", () => {
  const decoded = new Set<string>();
  for (const [index, receipt] of receipts.entries()) {
    const previous = receipts[index - 1];
    if (previous)
      expect(receipt.started - previous.finished).toBeGreaterThanOrEqual(3.5);
    const raw = bytes(root + receipt.file);
    expect(raw.byteLength).toBe(receipt.bytes);
    expect(createHash("sha256").update(raw).digest("hex")).toBe(receipt.sha256);
    if (!receipt.url.includes("vpic.nhtsa.dot.gov")) continue;
    if (!receipt.requestVins) throw new Error("Missing vPIC request VINs");
    const response = z
      .object({
        Count: z.number().int().min(1).max(50),
        Results: z.array(
          z.object({ VIN: z.string(), Make: z.string().min(1) }),
        ),
      })
      .parse(JSON.parse(raw.toString("utf8")));
    expect(response.Results).toHaveLength(response.Count);
    expect(response.Results.map((row) => row.VIN)).toEqual(receipt.requestVins);
    for (const row of response.Results) {
      expect(hollanderstoresVin(row.VIN)).toBe(row.VIN);
      expect(decoded.has(row.VIN)).toBe(false);
      expect(hollanderstoresSeed[row.VIN]).toBe(row.Make);
      decoded.add(row.VIN);
    }
  }
  expect(decoded.size).toBe(250);
});
