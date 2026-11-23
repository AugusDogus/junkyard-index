import { expect, test } from "bun:test";
import {
  URGIIS_CUT_TENANTS,
  URGIIS_TENANTS,
} from "~/server/ingestion/urgiis-configuration";
import { YardService } from "./yard-service";
import { UrgiisTenant } from "~/server/ingestion/urgiis-tenant";
import { resolveYardWebsite } from "./yard-website";
import { VehicleDestination } from "./vehicle-destination";
import { Yard } from "./yard";

for (const tenant of URGIIS_TENANTS) {
  for (const yard of UrgiisTenant.yards(tenant)) {
    test(`URG IIS retains ${yard.name} as its own physical yard and website`, () => {
      expect(Yard.parse(yard).success).toBe(true);
      expect(yard.lat).not.toBe(0);
      expect(yard.lng).not.toBe(0);
      expect(resolveYardWebsite({ ...yard, websiteUrl: null })).toEqual({
        kind: "yard",
        href: yard.websiteUrl,
      });
      const href =
        tenant.origin + "/" + tenant.pathStyle + "/HONDA/ACCORD/12345/2015";
      expect(
        VehicleDestination.resolve({ source: "urgiis", detailsUrl: href }),
      ).toEqual({ kind: "inventory", href, label: "View inventory" });
    });
  }
}
test("the 11 Cloudflare-blocked tenants the owner cut stay out of URG IIS with their 12 yards", () => {
  expect(URGIIS_CUT_TENANTS.size).toBe(11);
  const cutYards = [...URGIIS_CUT_TENANTS.values()].flat();
  expect(cutYards).toHaveLength(12);
  const yards = URGIIS_TENANTS.flatMap(UrgiisTenant.yards);
  for (const [code, yardCodes] of URGIIS_CUT_TENANTS) {
    expect(URGIIS_TENANTS.some((tenant) => tenant.code === code)).toBe(false);
    for (const yardCode of yardCodes) {
      expect(yards.some((yard) => yard.code === yardCode)).toBe(false);
      expect(YardService.resolve("urgiis", yardCode)).toMatchObject({
        kind: "unknown",
      });
    }
  }
  expect(URGIIS_TENANTS.map((tenant) => tenant.code)).toEqual([
    "eagle",
    "linders",
    "chuckran",
    "ace-st-paul",
    "chucks",
    "higgins",
    "lambert",
    "norbs",
    "stroud",
  ]);
});

test("URG IIS has no chain-wide fallback for an unknown independent yard", () => {
  expect(
    resolveYardWebsite({
      source: "urgiis",
      code: "unknown",
      name: "Unknown",
      state: "MN",
    }),
  ).toBeNull();
  const yards = URGIIS_TENANTS.flatMap(UrgiisTenant.yards);
  expect(new Set(yards.map((y) => y.code)).size).toBe(yards.length);
});
