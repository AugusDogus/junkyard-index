import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  hollanderstoresFixtureBody as body,
  hollanderstoresFixtureBytes as bytes,
  hollanderstoresFixturePages as pages,
  hollanderstoresExpected as expected,
} from "./hollanderstores-test-fixtures";
import {
  parseHollanderstoresPage,
  parseHollanderstoresRoster,
} from "./hollanderstores-parser";
import { HOLLANDERSTORES_YARDS } from "./hollanderstores-yard-metadata";
import { hollanderstoresSnapshot } from "./hollanderstores-snapshot";
import { hollanderstoresSeed } from "./hollanderstores-client";
import { hollanderstoresMissing } from "./hollanderstores-cursor";
import { hollanderstoresVin } from "./hollanderstores-vin";
import { resolveYardWebsite } from "~/lib/yard-website";

const root = `${import.meta.dir}/hollanderstores-test-fixtures/expansion/`;
const receipts = z
  .array(
    z.object({
      url: z.string(),
      file: z.string(),
      body: z.string().nullable().optional(),
      sha256: z.string().optional(),
      bytes: z.number().optional(),
      error: z.string().optional(),
    }),
  )
  .parse(JSON.parse(readFileSync(root + "requests.json", "utf8")));

test("every new yard has matching independent closing evidence and passes the shared quality rules", () => {
  const opening = pages();
  for (const [index, yard] of HOLLANDERSTORES_YARDS.entries()) {
    const page = opening[index];
    if (!page) throw new Error("Missing opening roster for " + yard.code);
    expect(
      parseHollanderstoresPage(body(yard.code + "-closing.html.gz"), index),
    ).toEqual(page);
    expect(yard.address).not.toMatch(/\b(?:PO|P\.?O\.?)\s*BOX\b/i);
    expect(resolveYardWebsite({ ...yard, websiteUrl: null })).toEqual({
      kind: "yard",
      href: yard.websiteUrl,
    });
  }
  const snapshot = hollanderstoresSnapshot(opening, hollanderstoresSeed);
  expect(snapshot.errors).toEqual([]);
  expect(snapshot.perYard).toEqual(expected.perYard);
  expect(snapshot.vehicles).toHaveLength(expected.count);
  expect(snapshot.observedVins).toEqual(expected.observedVins);
  expect(
    new Set(snapshot.vehicles.map((vehicle) => vehicle.detailsUrl)).size,
  ).toBe(snapshot.vehicles.length);
}, 30000);

test("all saved live responses retain exact byte counts and SHA-256 receipts", () => {
  const addressReceipts = z
    .array(
      z.object({ file: z.string(), sha256: z.string(), bytes: z.number() }),
    )
    .parse(JSON.parse(readFileSync(root + "address-evidence.json", "utf8")));
  for (const receipt of [...receipts, ...addressReceipts]) {
    if (!receipt.sha256 || receipt.bytes === undefined) continue;
    const raw = bytes(receipt.file);
    expect(raw.byteLength).toBe(receipt.bytes);
    expect(createHash("sha256").update(raw).digest("hex")).toBe(receipt.sha256);
  }
}, 30000);

test("new vPIC evidence covers only missing native makes, in unique batches of at most 50 valid VINs", () => {
  const previous = z
    .record(z.object({ Make: z.string() }))
    .parse(JSON.parse(body("vpic-audit.json.gz")));
  // OK was decoded during qualification, then excluded for unstable record order.
  const auditedYards = [
    ...HOLLANDERSTORES_YARDS,
    {
      ...HOLLANDERSTORES_YARDS[0],
      code: "okautoms",
      tenant: "1897",
      logo: "OK Auto Parts Inc.",
      websiteUrl: "https://okautoms.hollanderstores.com/",
    },
  ];
  const needed = new Set(
    hollanderstoresMissing({
      pages: auditedYards.map((yard) =>
        parseHollanderstoresRoster(
          body(
            yard.code +
              (existsSync(root + yard.code + "-initial.html.gz")
                ? "-initial"
                : "") +
              ".html.gz",
          ),
          yard,
        ),
      ),
    }).filter((vin) => !Object.hasOwn(previous, vin)),
  );
  const audited = new Set<string>();
  for (const receipt of receipts.filter(
    (receipt) => receipt.url.includes("vpic.nhtsa.dot.gov") && !receipt.error,
  )) {
    const response = z
      .object({
        Count: z.number(),
        Results: z
          .array(z.object({ VIN: z.string(), Make: z.string().nullable() }))
          .min(1)
          .max(50),
      })
      .parse(JSON.parse(body(receipt.file)));
    const requested =
      new URLSearchParams(receipt.body ?? "").get("data")?.split(";") ?? [];
    expect(response.Count).toBe(requested.length);
    expect(response.Results.map((row) => row.VIN).sort()).toEqual(
      [...requested].sort(),
    );
    expect(new Set(requested).size).toBe(requested.length);
    for (const row of response.Results) {
      expect(hollanderstoresVin(row.VIN)).toBe(row.VIN);
      expect(needed.has(row.VIN)).toBe(true);
      expect(audited.has(row.VIN)).toBe(false);
      audited.add(row.VIN);
      const make = row.Make?.trim();
      if (make && !/^(?:unknown|none|other|n\/?a|null|0+)$/i.test(make))
        expect(hollanderstoresSeed[row.VIN]).toBe(make);
      else {
        expect(hollanderstoresSeed[row.VIN]).toBeUndefined();
        expect(expected.failedMakeVins).toContain(row.VIN);
      }
    }
  }
  expect([...audited].sort()).toEqual([...needed].sort());
});

test("coordinates match saved Census, OSM buildings or business parcels, and yard-published map markers", () => {
  const locations = z
    .array(
      z.object({
        code: z.string(),
        provider: z.enum(["census", "nominatim", "yard-published"]),
        census: z.string(),
        nominatim: z.string().optional(),
        coordinateFile: z.string().optional(),
        lat: z.number(),
        lng: z.number(),
      }),
    )
    .parse(JSON.parse(readFileSync(root + "locations.json", "utf8")));
  for (const yard of HOLLANDERSTORES_YARDS.slice(5)) {
    const location = locations.find((location) => location.code === yard.code);
    if (!location)
      throw new Error("Missing coordinate evidence for " + yard.code);
    expect([location.lat, location.lng]).toEqual([yard.lat, yard.lng]);
    if (location.provider === "census") {
      const response = z
        .object({
          result: z.object({
            addressMatches: z
              .array(
                z.object({
                  coordinates: z.object({ x: z.number(), y: z.number() }),
                }),
              )
              .length(1),
          }),
        })
        .parse(JSON.parse(body(location.census)));
      expect(response.result.addressMatches[0]?.coordinates).toEqual({
        x: yard.lng,
        y: yard.lat,
      });
    } else if (location.provider === "nominatim") {
      if (!location.nominatim) throw new Error("Missing OSM response file");
      const response = z
        .array(
          z.object({
            lat: z.string(),
            lon: z.string(),
            address: z.object({ house_number: z.string() }),
          }),
        )
        .length(1)
        .parse(JSON.parse(body(location.nominatim)));
      expect([Number(response[0]?.lat), Number(response[0]?.lon)]).toEqual([
        yard.lat,
        yard.lng,
      ]);
      expect(response[0]?.address.house_number).toBe(
        yard.code === "conrads" ? "E9889" : "W227S2698",
      );
    } else {
      if (!location.coordinateFile)
        throw new Error("Missing published map response file");
      const markers = [
        ...body(location.coordinateFile).matchAll(
          /"[^"\n]+, [^"\n]+",\[(-?[\d.]+),(-?[\d.]+)\]/g,
        ),
      ];
      expect(
        markers.some(
          (marker) =>
            Number(marker[1]) === yard.lat && Number(marker[2]) === yard.lng,
        ),
      ).toBe(true);
    }
  }
});
