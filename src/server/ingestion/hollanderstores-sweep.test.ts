import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { hollanderstoresSeed } from "./hollanderstores-client";
import { hollanderstoresCensusError } from "./hollanderstores-census";
import { hollanderstoresMissing } from "./hollanderstores-cursor";
import { parseHollanderstoresRoster } from "./hollanderstores-parser";
import { hollanderstoresSnapshot } from "./hollanderstores-snapshot";
import {
  hollanderstoresFixtureBody as body,
  hollanderstoresFixtureBytes as bytes,
  hollanderstoresFixturePages as pages,
} from "./hollanderstores-test-fixtures";
import { HOLLANDERSTORES_YARDS } from "./hollanderstores-yard-metadata";
import { IngestionSourceFlags } from "./ingestion-source-flags";

const yard = HOLLANDERSTORES_YARDS.find((yard) => yard.code === "crossroid");
if (!yard) throw new Error("Missing qualified Crossroads tenant");
const opening = parseHollanderstoresRoster(body("crossroid.html.gz"), yard);

test("Crossroads reconciles both complete censuses and recovers only missing makes", () => {
  const closing = parseHollanderstoresRoster(
    body("crossroid-closing.html.gz"),
    yard,
  );
  expect(opening.total).toBe(111);
  expect(opening.rows).toHaveLength(111);
  expect(hollanderstoresCensusError(opening, closing)).toBeNull();
  const decoded = z
    .object({
      Count: z.literal(34),
      Results: z.array(
        z.object({
          VIN: z.string(),
          Make: z.string().min(1),
          ErrorCode: z.literal("0"),
        }),
      ),
    })
    .parse(JSON.parse(body("crossroid-vpic.json.gz")));
  const needed = hollanderstoresMissing({ pages: [opening] });
  expect(decoded.Results.map((row) => row.VIN)).toEqual(needed);
  expect(new Set(needed).size).toBe(34);
  for (const row of decoded.Results)
    expect(hollanderstoresSeed[row.VIN]).toBe(row.Make);

  const snapshot = hollanderstoresSnapshot(pages(), hollanderstoresSeed);
  expect(snapshot.errors).toEqual([]);
  expect(snapshot.perYard.find((row) => row.code === yard.code)).toEqual({
    code: "crossroid",
    total: 111,
    accepted: 111,
    rejected: 0,
    duplicates: 0,
  });
  expect(Math.floor(111 / 3)).toBe(yard.minimum);
  expect(IngestionSourceFlags.resolve({})).toContain("hollanderstores");
  expect(
    snapshot.vehicles.filter((row) => row.locationCode === yard.code),
  ).toHaveLength(111);

  const withoutDecodes = Object.fromEntries(
    Object.entries(hollanderstoresSeed).filter(
      ([vin]) => !needed.includes(vin),
    ),
  );
  expect(
    hollanderstoresSnapshot(pages(), withoutDecodes).rejectedYards.find(
      (rejected) => rejected.code === yard.code,
    )?.reason,
  ).toContain("Crossroads Salvage rejection ratio exceeds 10%");
}, 30000);

test("Crossroads has new vehicle destinations since the complete November 15 census", () => {
  const previous = Array.from({ length: 6 }, (_, index) =>
    body(`crossroid-nov15-page-${index + 1}.html.gz`),
  );
  const priorDestinations = previous.flatMap((raw) => {
    expect(raw).toContain("Showing 109 Vehicles in Inventory");
    return [
      ...raw.matchAll(/href="(\/VehicleDealerShowParts\/7206\/\d+)"/g),
    ].map((match) => new URL(match[1] ?? "", yard.websiteUrl).href);
  });
  expect(priorDestinations).toHaveLength(109);
  expect(new Set(priorDestinations).size).toBe(109);
  expect(
    opening.rows
      .filter((row) => !priorDestinations.includes(row.url))
      .map((row) => row.stock),
  ).toEqual(["CR2664", "CR2660", "CR2656"]);
  // Observed additions establish currency without inventing an arrival date.
  expect(
    hollanderstoresSnapshot(pages(), hollanderstoresSeed)
      .vehicles.filter((row) => row.locationCode === yard.code)
      .every((row) => row.availableDate === null),
  ).toBe(true);
});

test("Crossroads identity, address and native coordinates agree with the configured yard", () => {
  const about = body("crossroid-about.html.gz");
  expect(about).toContain("3415 Hoffman Lane");
  expect(about).toContain("Nampa, ID 83651");
  expect(about).toContain("(208) 467-7278");
  const website = body("crossroid-website.html.gz");
  expect(website.toLowerCase()).toContain("crossroid.hollanderstores.com");
  expect(website).toContain(`"latitude":"${yard.lat}"`);
  expect(website).toContain(`"longitude":"${yard.lng}"`);
});

test("Crossroads saved responses retain exact capture receipts", () => {
  const receipts = z
    .array(
      z.object({
        file: z.string(),
        bytes: z.number(),
        sha256: z.string(),
        status: z.literal(200),
      }),
    )
    .parse(
      JSON.parse(
        readFileSync(
          new URL(
            "./hollanderstores-test-fixtures/sweep/requests.json",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    );
  expect(receipts).toHaveLength(11);
  for (const receipt of receipts) {
    const raw = bytes(receipt.file);
    expect(raw.byteLength).toBe(receipt.bytes);
    expect(createHash("sha256").update(raw).digest("hex")).toBe(receipt.sha256);
  }
});
