import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { z } from "zod";
import { assessIisRecord } from "./iis-record";
import { iisCards, iisDirectory, iisOwnedUrl } from "./urgiis-catalog";
import { URGIIS_TENANTS } from "./urgiis-configuration";

const archive = z
  .object({
    requests: z.array(
      z.object({ key: z.string(), status: z.string(), sha256: z.string() }),
    ),
    bodies: z.record(z.string()),
  })
  .parse(
    JSON.parse(
      brotliDecompressSync(
        readFileSync(
          new URL(
            "./urgiis-test-fixtures/cap-investigation.json.br",
            import.meta.url,
          ),
        ),
      ).toString(),
    ),
  );
function capture(key: string) {
  const receipt = archive.requests.find((r) => r.key === key);
  const body = receipt && archive.bodies[receipt.sha256];
  if (!receipt || receipt.status !== "200" || !body)
    throw new Error("Missing successful cap investigation response: " + key);
  expect(createHash("sha256").update(body).digest("hex")).toBe(receipt.sha256);
  return body;
}

test("Smith's capped F150 result omits a valid own-yard arrival", () => {
  const site = {
    origin: "https://smithautone.com",
    urgid: "NE22",
    pathStyle: "parts" as const,
  };
  const models = iisDirectory(capture("smith-ford"), site, {
    path: "/parts/FORD",
    label: "FORD",
    count: 0,
  });
  expect(
    models.find((m) => m.path === "/parts/FORD/FORD_F150_PICKUP/")?.count,
  ).toBe(163);
  const model = iisCards(capture("smith-model"), site);
  expect(model.records).toHaveLength(30);
  const missing = iisCards(
    capture("smith-arrivals"),
    site,
    "arrivals",
  ).records.find((r) => r.stock === "261352");
  if (!missing) throw new Error("Missing saved Smith arrival 261352");
  const assessment = assessIisRecord(
    missing,
    { kind: "arrivals" },
    {
      ownedUrl: (raw) => iisOwnedUrl(raw, site),
      pathStyle: "parts",
      requireInquiry: false,
    },
  );
  expect(assessment.reasons).toEqual([]);
  expect(assessment.destination).toContain("/FORD/FORD_F150_PICKUP/");
  expect(missing.image).toContain("cloudfront.net/ne22/");
  expect(model.records.some((r) => r.stock === missing.stock)).toBe(false);
  expect(URGIIS_TENANTS.some((t) => t.urgid === "NE22")).toBe(false);
});

test("Heritage's unsupported query variants do not enumerate beyond its first 30 donors", () => {
  const site = {
    origin: "https://heritageautoparts.com",
    urgid: "NN36",
    pathStyle: "parts" as const,
  };
  const model = iisCards(capture("heritage-model"), site);
  expect(model.records).toHaveLength(30);
  for (const key of [
    "heritage-yr-query",
    "heritage-stock-query",
    "heritage-pagenum",
    "heritage-offset",
    "heritage-sort",
    "heritage-start",
    "heritage-paged",
  ])
    expect(iisCards(capture(key), site).records).toEqual(model.records);
});
