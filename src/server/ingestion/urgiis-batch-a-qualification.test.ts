import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { z } from "zod";
import { URGIIS_TENANTS } from "./urgiis-configuration";
import { iisCards, iisDirectory, iisOwnedUrl } from "./urgiis-catalog";
import { UrgiisControlSchema } from "./urgiis-schema";
import { assessIisRecord } from "./iis-record";

const captures = z
  .array(
    z.object({
      code: z.string(),
      key: z.string(),
      url: z.string().url(),
      html: z.string(),
    }),
  )
  .parse(
    JSON.parse(
      brotliDecompressSync(
        readFileSync(
          new URL(
            "./urgiis-test-fixtures/batch-a-probes.json.br",
            import.meta.url,
          ),
        ),
      ).toString(),
    ),
  );
const capture = (code: string, key: string) => {
  const response = captures.find((c) => c.code === code && c.key === key);
  if (!response)
    throw new Error(`Missing saved ${code} qualification response: ${key}`);
  return response;
};
const cutoffCases = [
  {
    code: "heritage",
    origin: "https://heritageautoparts.com",
    urgid: "NN36",
    key: "cutoff-15-24",
    menu: "menu-15",
    badge: 74,
  },
  {
    code: "i17",
    origin: "https://i17autoparts.com",
    urgid: "AZ29",
    key: "cutoff-21-6",
    menu: "menu-21",
    badge: 52,
  },
  {
    code: "speedway",
    origin: "https://speedwayap.com",
    urgid: "IL22",
    key: "cutoff-6-15",
    menu: "menu-6",
    badge: 86,
  },
  {
    code: "idrive",
    origin: "https://idriveautoparts.com",
    urgid: "MI47",
    key: "cutoff-12-12",
    menu: "menu-12",
    badge: 83,
  },
];
for (const candidate of cutoffCases) {
  test(`URG IIS keeps the truncated ${candidate.code} catalog out`, () => {
    const site = { ...candidate, pathStyle: "parts" as const };
    const response = capture(candidate.code, candidate.key);
    const menu = capture(candidate.code, candidate.menu);
    const make = iisDirectory(capture(candidate.code, "makes").html, site).find(
      (m) => site.origin + m.path === menu.url,
    );
    if (!make) throw new Error("Missing native make for " + candidate.code);
    const model = iisDirectory(menu.html, site, make).find(
      (m) => site.origin + m.path === response.url,
    );
    expect(model?.count).toBe(candidate.badge);
    const page = iisCards(response.html, site);
    expect(page.records).toHaveLength(30);
    const expanded = iisCards(
      capture(candidate.code, "recovery-per-page").html,
      site,
    );
    expect(expanded.records).toEqual(page.records);
    expect(candidate.badge).toBeGreaterThan(page.records.length);
    expect(URGIIS_TENANTS.some((t) => t.code === candidate.code)).toBe(false);
  });
}

test("Heritage's recent own-yard F250SD donors are absent from its model result", () => {
  const site = {
    origin: "https://heritageautoparts.com",
    urgid: "NN36",
    pathStyle: "parts" as const,
  };
  const model = iisCards(capture("heritage", "cutoff-15-24").html, site);
  const arrivals = iisCards(
    capture("heritage", "arrivals").html,
    site,
    "arrivals",
  );
  for (const stock of ["260444", "260443"]) {
    const record = arrivals.records.find((r) => r.stock === stock);
    if (!record) throw new Error("Missing native Heritage donor " + stock);
    const assessment = assessIisRecord(
      record,
      { kind: "arrivals" },
      {
        ownedUrl: (raw) => iisOwnedUrl(raw, site),
        pathStyle: "parts",
        requireInquiry: false,
      },
    );
    expect(assessment.reasons).toEqual([]);
    expect(assessment.destination).toContain("/FORD/FORD_F250SD_PICKUP/");
    expect(record.image).toContain("cloudfront.net/nn36/");
    expect(model.records.some((r) => r.stock === stock)).toBe(false);
  }
});

test("Stadium's F150 result reaches 500 shared cards before CO10 filtering", () => {
  const site = {
    origin: "https://www.stadiumautoparts.com",
    urgid: "CO10",
    pathStyle: "parts" as const,
  };
  const page = iisCards(capture("stadium", "cutoff-11-17").html, site);
  expect(page.records).toHaveLength(500);
  expect(page.capped).toBe(true);
  const suppliers = new Set(
    page.records.flatMap(
      (r) => r.image?.match(/cloudfront\.net\/([^/]+)\//)?.[1] ?? [],
    ),
  );
  expect(suppliers).toEqual(new Set(["cc24", "co10"]));
  expect(URGIIS_TENANTS.some((t) => t.code === "stadium")).toBe(false);
});

test("Tom's published blank Maserati model cannot form a complete graph", () => {
  const site = {
    origin: "https://tomssalvage.com",
    urgid: "TT68",
    pathStyle: "parts" as const,
  };
  const make = UrgiisControlSchema.parse({
    path: "/parts/MASERATI",
    label: "MASERATI",
    count: 1,
  });
  expect(() =>
    iisDirectory(capture("toms", "menu-25").html, site, make),
  ).toThrow("invalid destination, parent, label or count");
  expect(URGIIS_TENANTS.some((t) => t.code === "toms")).toBe(false);
});

test("Higgins' exact native arrivals title admits its donor cards", () => {
  const site = {
    origin: "https://higginsauto.com",
    urgid: "CA22",
    pathStyle: "parts" as const,
  };
  const html = capture("higgins", "arrivals").html;
  expect(iisCards(html, site, "arrivals").records).toHaveLength(60);
  for (const title of [
    "New Arrivals, Recycled Vehicles",
    "New Arrivals, Recycled Vehicles - Another Yard",
    "Used Auto Parts - Higgins Auto Parts",
  ])
    expect(() =>
      iisCards(
        html.replace(/<title>.*?<\/title>/, `<title>${title}</title>`),
        site,
        "arrivals",
      ),
    ).toThrow("native arrivals title");
  expect(URGIIS_TENANTS.some((t) => t.code === "higgins")).toBe(true);
});

test("Higgins' eight arrivals-only donors retain valid identities and empty native parts results", () => {
  const site = {
    origin: "https://higginsauto.com",
    urgid: "CA22",
    pathStyle: "parts" as const,
  };
  const arrivals = iisCards(
    capture("higgins", "arrivals").html,
    site,
    "arrivals",
  );
  const details = z
    .array(z.object({ url: z.string().url(), html: z.string() }))
    .length(8)
    .parse(
      JSON.parse(
        brotliDecompressSync(
          readFileSync(
            new URL(
              "./urgiis-test-fixtures/higgins-arrivals-only.json.br",
              import.meta.url,
            ),
          ),
        ).toString(),
      ),
    );
  for (const detail of details) {
    const record = arrivals.records.find((r) =>
      r.destinations.includes(detail.url),
    );
    if (!record)
      throw new Error("Missing native Higgins arrival: " + detail.url);
    expect(
      assessIisRecord(
        record,
        { kind: "arrivals" },
        {
          ownedUrl: (raw) => iisOwnedUrl(raw, site),
          pathStyle: "parts",
          requireInquiry: false,
        },
      ).reasons,
    ).toEqual([]);
    const page = iisCards(detail.html, site);
    expect(page.nativeEmpty).toBe(true);
    expect(page.records).toHaveLength(0);
  }
});
