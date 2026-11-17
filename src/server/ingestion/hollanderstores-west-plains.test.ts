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
import { hollanderstoresSnapshot } from "./hollanderstores-snapshot";
import { hollanderstoresSeed } from "./hollanderstores-client";
import { hollanderstoresVin } from "./hollanderstores-vin";
import { IngestionSourceFlags } from "./ingestion-source-flags";
import { SourceValidationPolicy } from "./source-validation";

const additions = [
  { code: "a1nm", state: "NM", total: 1029, accepted: 993, rejected: 36 },
  { code: "hsaw", state: "WA", total: 33, accepted: 33, rejected: 0 },
  { code: "mwas", state: "OK", total: 224, accepted: 221, rejected: 3 },
  { code: "kramers", state: "NE", total: 5, accepted: 5, rejected: 0 },
] as const;
const root = `${import.meta.dir}/hollanderstores-test-fixtures/west-plains/`;
const read = (file: string) => body("west-plains/" + file + ".gz");
const receipts = z
  .array(
    z.object({
      url: z.string().url(),
      body: z.string().nullable(),
      file: z.string(),
      status: z.number(),
      started: z.number(),
      finished: z.number(),
      bytes: z.number(),
      sha256: z.string(),
    }),
  )
  .parse(JSON.parse(readFileSync(root + "requests.json", "utf8")));

test("admits complete west/plains rosters under independent quality guards and one-third floors", () => {
  const snapshot = hollanderstoresSnapshot(pages(), hollanderstoresSeed);
  expect(snapshot.errors).toEqual([]);
  for (const expected of additions) {
    const yard = HOLLANDERSTORES_YARDS.find(
      (yard) => yard.code === expected.code,
    );
    if (!yard) throw new Error("Missing qualified yard " + expected.code);
    expect(yard.state).toBe(expected.state);
    expect<number>(yard.minimum).toBe(
      Math.max(1, Math.floor(expected.accepted / 3)),
    );
    const opening = parseHollanderstoresRoster(read(yard.code + ".html"), yard);
    const closing = parseHollanderstoresRoster(
      read(yard.code + "-closing.html"),
      yard,
    );
    expect(hollanderstoresCensusError(opening, closing)).toBeNull();
    expect(
      snapshot.perYard.find((row) => row.code === yard.code),
    ).toMatchObject({
      code: expected.code,
      total: expected.total,
      accepted: expected.accepted,
      rejected: expected.rejected,
      duplicates: 0,
    });
    // Independently count every original card and destination, including rejects.
    const raw = read(yard.code + ".html");
    expect(raw.match(/class="individualPartHolder"/g)).toHaveLength(
      expected.total,
    );
    expect(
      new Set(
        [...raw.matchAll(/href="(\/VehicleDealerShowParts\/\d+\/\d+)"/g)].map(
          (m) => m[1],
        ),
      ).size,
    ).toBe(expected.total);
    const vehicles = snapshot.vehicles.filter(
      (row) => row.locationCode === yard.code,
    );
    expect(vehicles).toHaveLength(expected.accepted);
    for (const vehicle of vehicles) {
      expect(hollanderstoresVin(vehicle.vin)).toBe(vehicle.vin);
      expect(vehicle.stateAbbr).toBe(expected.state);
      expect(vehicle.detailsUrl).toStartWith(
        yard.websiteUrl + "VehicleDealerShowParts/" + yard.tenant + "/",
      );
      expect(vehicle.availableDate).toBeNull();
    }
  }
  expect(new Set(additions.map((row) => row.code)).size).toBe(4);
  expect(IngestionSourceFlags.resolve({})).toContain("hollanderstores");
  expect(SourceValidationPolicy.minimumUniqueInventory.hollanderstores).toBe(
    HOLLANDERSTORES_YARDS.reduce((sum, yard) => sum + yard.minimum, 0),
  );
}, 30000);

test("generic Midwest logo cannot admit a foreign tenant or a partial roster", () => {
  const yard = HOLLANDERSTORES_YARDS.find((yard) => yard.code === "mwas");
  if (!yard) throw new Error("Missing Midwest yard");
  const raw = read("mwas.html");
  for (const changed of [
    raw.replace("Showing 224", "Showing 225"),
    raw.replace("/VehicleDealerShowParts/7342/", "/VehicleDealerShowParts/44/"),
    raw.slice(0, -100),
  ])
    expect(() => parseHollanderstoresRoster(changed, yard)).toThrow();
  const directory = read("hollander-plains.html");
  const owner = directory
    .split('<div class="onerow">')
    .find((block) => block.includes("mwas.hollanderstores.com"));
  expect(owner).toContain("Midwest Auto Parts");
  expect(owner).toContain("3815 N Lewis");
  expect(owner).toContain("Tulsa, OK 74110");
});

test("new physical coordinates match exact addresses, with a business marker for Kramer", () => {
  const census = z.object({
    result: z.object({
      addressMatches: z
        .array(
          z.object({
            coordinates: z.object({ x: z.number(), y: z.number() }),
            addressComponents: z.object({ state: z.string(), zip: z.string() }),
          }),
        )
        .length(1),
    }),
  });
  for (const { code } of additions) {
    const yard = HOLLANDERSTORES_YARDS.find((yard) => yard.code === code);
    if (!yard) throw new Error("Missing location " + code);
    const about = read(code + "-about.html");
    expect(about).toContain(yard.postalCode);
    expect(about).toContain(yard.phone);
    if (code === "kramers") {
      const marker = read("kramers-map.html");
      expect(marker).toContain("0x8799877132d8e29f:0xe9e10421b8e8b823");
      expect(marker).toContain(
        '3405 Hwy 281, Grand Island, NE 68803",[40.9644352,-98.3581909]',
      );
      expect([yard.lat, yard.lng]).toEqual([40.9644352, -98.3581909]);
      expect(read("kramers-official.html")).toContain("308-384-1116");
    } else {
      const match = census.parse(JSON.parse(read(code + "-geocode.json")))
        .result.addressMatches[0];
      expect(match?.coordinates).toEqual({ x: yard.lng, y: yard.lat });
      expect(match?.addressComponents).toMatchObject({
        state: yard.state,
        zip: yard.postalCode,
      });
    }
    expect(yard.address).not.toMatch(/\b(?:PO|P\.?O\.?)\s*BOX\b/i);
  }
  expect(read("hollander-northwest.html")).toContain("99 Road 6100");
});

test("all 364 new vPIC results belong to valid native VINs with missing makes", () => {
  const native = pages()
    .filter((page) => additions.some((yard) => yard.code === page.yard))
    .flatMap((page) => page.rows);
  const seen = new Set<string>();
  for (const receipt of receipts.filter((row) =>
    row.url.includes("vpic.nhtsa.dot.gov"),
  )) {
    const requested =
      new URLSearchParams(receipt.body ?? "").get("data")?.split(";") ?? [];
    const response = z
      .object({
        Count: z.number(),
        Results: z
          .array(z.object({ VIN: z.string(), Make: z.string().trim().min(1) }))
          .max(50),
      })
      .parse(JSON.parse(read(receipt.file)));
    expect(response.Count).toBe(requested.length);
    expect(response.Results.map((row) => row.VIN).sort()).toEqual(
      [...requested].sort(),
    );
    for (const row of response.Results) {
      expect(seen.has(row.VIN)).toBe(false);
      seen.add(row.VIN);
      expect(hollanderstoresVin(row.VIN)).toBe(row.VIN);
      expect(
        native.some((record) => record.vin === row.VIN && record.make === null),
      ).toBe(true);
      expect(hollanderstoresSeed[row.VIN]).toBe(row.Make);
    }
  }
  expect(seen.size).toBe(364);
});

test("saved receipts preserve original bytes and serial qualification pacing", () => {
  for (const receipt of receipts) {
    const raw = bytes("west-plains/" + receipt.file + ".gz");
    expect(raw.byteLength).toBe(receipt.bytes);
    expect(createHash("sha256").update(raw).digest("hex")).toBe(receipt.sha256);
  }
  // Initial exploration had overlapping probes. The qualification phase uses
  // a process lock and 4.2-second completed gaps, including failed requests.
  const start = receipts.findIndex((row) => row.file === "vpic-0.json");
  expect(start).toBeGreaterThanOrEqual(0);
  for (let index = start + 1; index < receipts.length; index++) {
    const previous = receipts[index - 1],
      current = receipts[index];
    if (!previous || !current) throw new Error("Missing request receipt");
    expect(current.started - previous.finished).toBeGreaterThanOrEqual(4.19);
  }
});
