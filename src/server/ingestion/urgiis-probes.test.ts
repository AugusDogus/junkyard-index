import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { z } from "zod";
import {
  iisCards,
  iisDirectory,
  iisDocument,
  iisOwnedUrl,
} from "./urgiis-catalog";
import { iisAttribute, iisClass, iisElements, iisText } from "./iis-html";
import { URGIIS_TENANTS } from "./urgiis-configuration";
import { UrgiisControlSchema } from "./urgiis-schema";
import { assessIisRecord } from "./iis-record";

const probes = z
  .array(
    z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("model"),
        i: z.number(),
        name: z.string(),
        site: z.object({
          origin: z.string().url(),
          urgid: z.string(),
          pathStyle: z.enum(["parts", "used-parts"]),
        }),
        make: UrgiisControlSchema,
        model: UrgiisControlSchema,
        html: z.string(),
      }),
      z.object({
        kind: z.literal("detail"),
        i: z.number(),
        key: z.string(),
        html: z.string(),
      }),
    ]),
  )
  .parse(
    JSON.parse(
      brotliDecompressSync(
        readFileSync(
          new URL("./urgiis-test-fixtures/probes.json.br", import.meta.url),
        ),
      ).toString(),
    ),
  );
const expectedCards: Readonly<Record<number, number>> = {
  0: 30,
  1: 17,
  2: 0,
  3: 113,
  4: 57,
  5: 99,
  6: 415,
  7: 500,
  8: 406,
  9: 0,
  10: 73,
  11: 500,
  12: 113,
  13: 500,
  14: 25,
  15: 142,
  16: 84,
  17: 30,
  18: 137,
  19: 0,
  20: 55,
  21: 85,
};
for (const probe of probes) {
  if (probe.kind !== "model") continue;
  test(`URG IIS parses the saved ${probe.name} donor template`, () => {
    const page = iisCards(probe.html, probe.site);
    const expected = expectedCards[probe.i];
    if (expected === undefined)
      throw new Error("Missing independent probe count");
    expect(page.records.length).toBe(expected);
    expect(page.capped).toBe(page.records.length >= 500);
    expect(page.nativeEmpty).toBe(page.records.length === 0);
    for (const record of page.records) {
      const assessment = assessIisRecord(
        record,
        { kind: "model", make: probe.make, model: probe.model },
        {
          ownedUrl: (r) => iisOwnedUrl(r, probe.site),
          pathStyle: probe.site.pathStyle,
          requireInquiry: false,
        },
      );
      if (assessment.reasons.length === 0) {
        expect(assessment.vin).not.toBeNull();
        expect(assessment.destination).toStartWith(
          probe.site.origin + "/parts/",
        );
      }
    }
  });
}
test("URG IIS saved probes retain shared pools and both empty Nationwide Mercedes pages", () => {
  for (const i of [1, 7, 11, 13, 17]) {
    const probe = probes.find((p) => p.i === i && p.kind === "model");
    if (!probe || probe.kind !== "model")
      throw new Error("Missing shared-pool probe");
    const photoCodes = new Set(
      iisCards(probe.html, probe.site).records.flatMap(
        (r) => r.image?.match(/cloudfront\.net\/([^/]+)\//)?.[1] ?? [],
      ),
    );
    expect(
      [...photoCodes].some(
        (code) => !probe.site.urgid.toLowerCase().split(",").includes(code),
      ),
    ).toBe(true);
  }
  const nationwide = probes.find((p) => p.i === 3 && p.kind === "model");
  if (!nationwide || nationwide.kind !== "model")
    throw new Error("Missing Nationwide site");
  for (const probe of probes.filter((p) => p.i === 3 && p.kind === "detail"))
    expect(iisCards(probe.html, nationwide.site).nativeEmpty).toBe(true);
});

test("Brown's largest shared model reaches the 500-card cap before own-yard filtering", () => {
  const site = probes.find((p) => p.i === 1 && p.kind === "model");
  const raw = probes.find(
    (p) =>
      p.i === 1 && p.kind === "detail" && p.key === "recovery-largest-model",
  );
  if (!site || site.kind !== "model" || !raw)
    throw new Error("Missing Brown's cap evidence");
  const page = iisCards(raw.html, site.site);
  expect(page.records).toHaveLength(500);
  expect(page.capped).toBe(true);
  const own = page.records.filter((r) =>
    r.image?.includes("cloudfront.net/bb86/"),
  );
  expect(own.length).toBeGreaterThan(0);
  expect(own.length).toBeLessThan(500);
});

test("APS cannot complete its published make graph through an empty vehicle table", () => {
  const site = probes.find((p) => p.i === 17 && p.kind === "model");
  const makes = probes.find(
    (p) => p.i === 17 && p.kind === "detail" && p.key === "makes",
  );
  if (!site || site.kind !== "model" || !makes)
    throw new Error("Missing APS directory evidence");
  const make = iisDirectory(makes.html, site.site).find(
    (m) => m.path === "/parts/ROVER_-_STERLING",
  );
  if (!make) throw new Error("Missing published APS Rover make");
  expect(make.count).toBe(1);
  for (const key of ["make-42", "recovery-rover-0", "recovery-rover-1"]) {
    const response = probes.find(
      (p) => p.i === 17 && p.kind === "detail" && p.key === key,
    );
    if (!response) throw new Error("Missing APS response: " + key);
    expect(() => iisDirectory(response.html, site.site, make)).toThrow(
      "Expected one complete native inventory region",
    );
  }
});

test("Metro reaches the shared 500-card boundary before its MN06 filter", () => {
  const site = probes.find((p) => p.i === 19 && p.kind === "model");
  const response = probes.find(
    (p) => p.i === 19 && p.kind === "detail" && p.key === "capped-f150",
  );
  if (!site || site.kind !== "model" || !response)
    throw new Error("Missing Metro cap evidence");
  const page = iisCards(response.html, site.site);
  expect(page.records).toHaveLength(500);
  expect(page.capped).toBe(true);
  expect(
    page.records.some(
      (r) =>
        r.image?.includes("cloudfront.net/") &&
        !r.image.includes("cloudfront.net/mn06/"),
    ),
  ).toBe(true);
});

test("Chuck's explicit bins contain parts from unrelated vehicles, while empty details remain rejects", () => {
  const tenant = URGIIS_TENANTS.find((t) => t.code === "chucks");
  if (!tenant) throw new Error("Missing qualified Chuck's tenant");
  expect(tenant.placeholderStocks).toHaveLength(25);
  for (const stock of tenant.placeholderStocks) {
    const probe = probes.find(
      (p) => p.i === 18 && p.kind === "detail" && p.key === "bin-" + stock,
    );
    if (!probe) throw new Error("Missing native Chuck's bin proof: " + stock);
    const html = iisDocument(probe.html, tenant);
    const values = (name: string) =>
      [...html.matchAll(/<input\b[^>]*>/gi)].flatMap(([tag]) =>
        iisAttribute(tag, "name") === name
          ? [iisAttribute(tag, "value") ?? ""]
          : [],
      );
    const stockClaims = values("stockno");
    expect(stockClaims.length).toBeGreaterThanOrEqual(2);
    expect(stockClaims.every((value) => value === stock)).toBe(true);
    expect(new Set(values("make").filter(Boolean)).size).toBeGreaterThanOrEqual(
      2,
    );
    expect(
      new Set(values("yearin").filter((v) => v !== "" && v !== "0")).size,
    ).toBeGreaterThanOrEqual(2);
    expect(
      iisElements(html, "li", (tag) => iisClass(tag, "iis-lisku")).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      iisElements(html, "li", (tag) => iisClass(tag, "iispartpagevin")),
    ).toHaveLength(0);
  }
  for (const stock of ["NEW", "RIDE"]) {
    const probe = probes.find(
      (p) => p.i === 18 && p.kind === "detail" && p.key === "bin-" + stock,
    );
    if (!probe) throw new Error("Missing empty Chuck's detail: " + stock);
    expect(iisText(iisDocument(probe.html, tenant))).toContain("No Results");
    expect(tenant.placeholderStocks).not.toContain(stock);
  }
});
