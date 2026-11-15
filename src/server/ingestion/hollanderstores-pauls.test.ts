import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  hollanderstoresFixtureBody as body,
  hollanderstoresFixtureBytes as bytes,
  hollanderstoresFixturePages as pages,
  hollanderstoresExpected as expected,
} from "./hollanderstores-test-fixtures";
import { HOLLANDERSTORES_YARDS } from "./hollanderstores-yard-metadata";
import { hollanderstoresMissing } from "./hollanderstores-cursor";
import { hollanderstoresSeed } from "./hollanderstores-client";
import { hollanderstoresVin } from "./hollanderstores-vin";
import { hollanderstoresSnapshot } from "./hollanderstores-snapshot";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";

const root = `${import.meta.dir}/hollanderstores-test-fixtures/`;
const receiptSchema = z.array(
  z.object({
    url: z.string(),
    file: z.string(),
    body: z.string().nullable().optional(),
    bytes: z.number().optional(),
    sha256: z.string().optional(),
    error: z.string().optional(),
  }),
);
const receipts = receiptSchema.parse(
  JSON.parse(readFileSync(root + "pauls/requests.json", "utf8")),
);
const yards = HOLLANDERSTORES_YARDS.filter(
  (yard) => yard.operator === "Paul's Auto Yard",
);
const codes = new Set<string>(yards.map((yard) => yard.code));
const decodedSchema = z.object({
  Count: z.number(),
  Results: z
    .array(z.object({ VIN: z.string(), Make: z.string().nullable() }))
    .min(1)
    .max(50),
});
const usableMake = (make: string | null) =>
  !!make?.trim() &&
  !/^(?:unknown|none|other|n\/?a|null|0+)$/i.test(make.trim());

test("Paul's nine tenants are distinct physical locations of one business with no invented arrival dates", () => {
  expect([...codes].sort()).toEqual([
    "pauldemin",
    "paulelkin",
    "paullogin",
    "paulmerin",
    "paulsfwin",
    "paulsknox",
    "paulslkin",
    "paulsouin",
    "paulswvin",
  ]);
  const inventory = body("pauls-inventory.html.gz").toLowerCase();
  for (const yard of yards) {
    expect(inventory).toContain(yard.code + ".hollanderstores.com");
    expect(yard.name).toStartWith("Paul's Auto Yard - ");
    expect(yard.state).toBe("IN");
    expect(yard.address).not.toMatch(/\b(?:PO|P\.?O\.?)\s*BOX\b/i);
  }
  expect(new Set(yards.map((yard) => yard.address)).size).toBe(9);
  expect(new Set(yards.map((yard) => `${yard.lat},${yard.lng}`)).size).toBe(9);
  const logansport = yards.find((yard) => yard.code === "paullogin");
  expect(logansport?.address).toBe("1834 18th Street");
  expect(logansport?.city).toBe("Logansport");
  expect(
    stripInventoryRawText(body("pauls-logansport.html.gz"))
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  ).toContain("1834 18th Street Logansport, IN 46947");
  expect(yards.find((yard) => yard.code === "paulelkin")?.name).toContain(
    "Elkhart North",
  );
  const snapshot = hollanderstoresSnapshot(pages(), hollanderstoresSeed);
  expect(snapshot.errors).toEqual([]);
  const vehicles = snapshot.vehicles.filter((vehicle) =>
    codes.has(vehicle.locationCode),
  );
  expect(vehicles.length).toBe(
    expected.perYard
      .filter((yard) => codes.has(yard.code))
      .reduce((sum, yard) => sum + yard.accepted, 0),
  );
  expect(vehicles.every((vehicle) => vehicle.availableDate === null)).toBe(
    true,
  );
}, 30000);

test("Paul's saved responses retain exact bytes and every point matches published markers or Census aliases", () => {
  for (const receipt of receipts) {
    if (!receipt.sha256 || receipt.bytes === undefined) continue;
    const raw = bytes("pauls/" + receipt.file);
    expect(raw.byteLength).toBe(receipt.bytes);
    expect(createHash("sha256").update(raw).digest("hex")).toBe(receipt.sha256);
  }
  const locations = z
    .array(
      z.object({
        code: z.string(),
        provider: z.enum(["census", "yard-published"]),
        coordinateFile: z.string().optional(),
        publishedMapAddress: z.string().optional(),
      }),
    )
    .parse(JSON.parse(readFileSync(root + "pauls/locations.json", "utf8")));
  for (const yard of yards) {
    const location = locations.find((location) => location.code === yard.code);
    if (!location)
      throw new Error("Missing Paul's coordinate evidence: " + yard.code);
    const response = z
      .object({
        result: z.object({
          addressMatches: z
            .array(
              z.object({
                coordinates: z.object({ x: z.number(), y: z.number() }),
                addressComponents: z.object({
                  state: z.string(),
                  zip: z.string(),
                }),
              }),
            )
            .min(1),
        }),
      })
      .parse(JSON.parse(body(yard.code + "-geocode.json.gz")));
    // Knox has two road-name aliases for the same Census point, not two candidate yards.
    for (const match of response.result.addressMatches) {
      if (location.provider === "census")
        expect(match.coordinates).toEqual({ x: yard.lng, y: yard.lat });
      expect(match.addressComponents).toEqual({
        state: yard.state,
        zip: yard.postalCode,
      });
    }
    if (location.provider === "yard-published") {
      if (!location.coordinateFile || !location.publishedMapAddress)
        throw new Error("Missing Paul's published map evidence: " + yard.code);
      const markers =
        body(location.coordinateFile).match(/<[^>]+\bdata-lat="[^>]+>/g) ?? [];
      expect(
        markers.some(
          (tag) =>
            Number(inventoryHtmlAttribute(tag, "data-lat")) === yard.lat &&
            Number(inventoryHtmlAttribute(tag, "data-lng")) === yard.lng &&
            inventoryHtmlAttribute(tag, "data-address") ===
              location.publishedMapAddress &&
            inventoryHtmlAttribute(tag, "icon") === "true",
        ),
      ).toBe(true);
    }
  }
}, 30000);

test("Paul's vPIC requests decode only new missing makes and reuse all prior successful audit results", () => {
  const previous = new Set(
    Object.keys(
      z
        .record(z.object({ Make: z.string() }))
        .parse(JSON.parse(body("vpic-audit.json.gz"))),
    ),
  );
  const earlier = receiptSchema.parse(
    JSON.parse(readFileSync(root + "expansion/requests.json", "utf8")),
  );
  for (const receipt of earlier.filter(
    (receipt) => receipt.url.includes("vpic.nhtsa.dot.gov") && !receipt.error,
  )) {
    for (const row of decodedSchema.parse(JSON.parse(body(receipt.file)))
      .Results)
      if (usableMake(row.Make)) previous.add(row.VIN);
  }
  const needed = new Set(
    hollanderstoresMissing({
      pages: pages().filter((page) => codes.has(page.yard)),
    }).filter((vin) => !previous.has(vin)),
  );
  const audited = new Set<string>();
  for (const receipt of receipts.filter(
    (receipt) => receipt.url.includes("vpic.nhtsa.dot.gov") && !receipt.error,
  )) {
    const requested =
      new URLSearchParams(receipt.body ?? "").get("data")?.split(";") ?? [];
    const response = decodedSchema.parse(
      JSON.parse(body("pauls/" + receipt.file)),
    );
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
      if (usableMake(row.Make))
        expect(hollanderstoresSeed[row.VIN]).toBe(row.Make?.trim());
      else {
        expect(hollanderstoresSeed[row.VIN]).toBeUndefined();
        expect(expected.failedMakeVins).toContain(row.VIN);
      }
    }
  }
  expect([...audited].sort()).toEqual([...needed].sort());
}, 30000);
