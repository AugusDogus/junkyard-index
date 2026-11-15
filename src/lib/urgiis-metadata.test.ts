import { expect, test } from "bun:test";
import { URGIIS_TENANTS } from "~/server/ingestion/urgiis-configuration";
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
