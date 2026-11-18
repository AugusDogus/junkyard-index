import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { beaversText } from "./beavers-html";
import { stripInventoryRawText } from "./inventory-html";
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

const yard = HOLLANDERSTORES_YARDS.find(
  (item) => item.code === "paradiseautopar",
);
if (!yard) throw new Error("Missing Paradise Auto Parts qualification");
const text = (file: string) => beaversText(stripInventoryRawText(body(file)));

test("Paradise's independent complete censuses reconcile and pass the unchanged source guards", () => {
  const opening = parseHollanderstoresRoster(
    body(yard.code + ".html.gz"),
    yard,
  );
  const closing = parseHollanderstoresRoster(
    body(yard.code + "-closing.html.gz"),
    yard,
  );
  expect(opening.total).toBe(488);
  expect(closing).toEqual(opening);
  expect(hollanderstoresCensusError(opening, closing)).toBeNull();
  expect(new Set(opening.rows.map((row) => row.vin)).size).toBe(488);
  expect(
    opening.rows.every((row) => hollanderstoresVin(row.vin) === row.vin),
  ).toBe(true);
  const snapshot = hollanderstoresSnapshot(pages(), hollanderstoresSeed);
  expect(snapshot.errors).toEqual([]);
  expect(snapshot.perYard.find((item) => item.code === yard.code)).toEqual({
    code: yard.code,
    accepted: 488,
    rejected: 0,
    duplicates: 0,
    total: 488,
  });
  const vehicles = snapshot.vehicles.filter(
    (vehicle) => vehicle.locationCode === yard.code,
  );
  expect(vehicles).toHaveLength(488);
  expect(
    vehicles.every(
      (vehicle) => vehicle.stateAbbr === "MD" && vehicle.availableDate === null,
    ),
  ).toBe(true);
  expect(Math.floor(vehicles.length / 3)).toBe(yard.minimum);
  expect(IngestionSourceFlags.resolve({})).toContain("hollanderstores");
}, 30000);

test("Paradise's current native part and business marker agree on the physical yard and recent stock", () => {
  const part = text("paradise/paradise-part.html.gz");
  expect(part).toContain(
    "Paradise Auto Parts 929 W Pulaski Hwy Elkton, MD 21921",
  );
  expect(part).toContain("410-398-6727");
  expect(part).toContain("Stock # L73713");
  expect(part).toContain("2021 RAM15NEW");
  expect(part).toContain("Date Acquired 11/17/2026 5:00:00 AM");
  const opening = parseHollanderstoresRoster(
    body(yard.code + ".html.gz"),
    yard,
  );
  expect(opening.rows.find((row) => row.stock === "L73713")).toMatchObject({
    vin: "1C6SRFJTXMN677003",
    model: "RAM15NEW",
    displayYear: "'21",
    url: yard.websiteUrl + "VehicleDealerShowParts/439/72826125",
  });
  expect(body("paradise/paradise-donor.html.gz")).toContain(
    "/VehiclePartDetail/439/2800902/3/435",
  );
  const map = z
    .object({
      tasks: z.array(
        z.object({
          result: z.array(
            z.object({
              items: z.array(
                z.object({
                  title: z.string(),
                  address: z.string(),
                  latitude: z.number(),
                  longitude: z.number(),
                }),
              ),
            }),
          ),
        }),
      ),
    })
    .parse(JSON.parse(body("paradise/paradise-map.json.gz")));
  const markers = map.tasks.flatMap((task) =>
    task.result.flatMap((result) => result.items),
  );
  expect(markers).toHaveLength(1);
  expect(markers[0]).toMatchObject({
    title: "Paradise Auto Parts Inc",
    address: "929 W Pulaski Hwy B, Elkton, MD 21921",
    latitude: yard.lat,
    longitude: yard.lng,
  });
});

test("Paradise's four vPIC batches decode exactly its 182 missing native makes", () => {
  const opening = parseHollanderstoresRoster(
    body(yard.code + ".html.gz"),
    yard,
  );
  const missing = opening.rows
    .filter((row) => row.make === null)
    .map((row) => row.vin)
    .sort();
  expect(missing).toHaveLength(182);
  const decoded: string[] = [];
  for (let batch = 0; batch < 4; batch++) {
    const response = z
      .object({
        Count: z.number(),
        Results: z
          .array(
            z.object({
              VIN: z.string(),
              Make: z.string().min(1),
              ErrorCode: z.literal("0"),
            }),
          )
          .min(1)
          .max(50),
      })
      .parse(JSON.parse(body(`paradise/paradise-vpic-${batch}.json.gz`)));
    expect(response.Results).toHaveLength(response.Count);
    for (const row of response.Results) {
      expect(hollanderstoresVin(row.VIN)).toBe(row.VIN);
      expect(hollanderstoresSeed[row.VIN]).toBe(row.Make);
      decoded.push(row.VIN);
    }
  }
  expect(decoded.sort()).toEqual(missing);
  expect(new Set(decoded).size).toBe(182);
});

test("Paradise's retained qualification responses have exact bytes and hashes", () => {
  const receipts = z
    .array(
      z.object({ file: z.string(), bytes: z.number(), sha256: z.string() }),
    )
    .parse(
      JSON.parse(
        readFileSync(
          `${import.meta.dir}/hollanderstores-test-fixtures/paradise/requests.json`,
          "utf8",
        ),
      ),
    );
  expect(receipts).toHaveLength(10);
  for (const receipt of receipts) {
    const raw = bytes("paradise/" + receipt.file);
    expect(raw.byteLength).toBe(receipt.bytes);
    expect(createHash("sha256").update(raw).digest("hex")).toBe(receipt.sha256);
  }
});
