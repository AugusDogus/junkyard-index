import { expect, test } from "bun:test";
import { soakUrgiisInventory, urgiisSoakTenants } from "./soak-urgiis";
import { UrgiisCursor } from "../src/server/ingestion/urgiis-cursor";
import { URGIIS_TENANTS } from "../src/server/ingestion/urgiis-configuration";

test("--urgiis-tenants picks configured tenants in crawl order and refuses unknown codes", () => {
  expect(urgiisSoakTenants("mars,dings").map((t) => t.code)).toEqual([
    "dings",
    "mars",
  ]);
  expect(() => urgiisSoakTenants("dings,nowhere")).toThrow(
    '--urgiis-tenants names "nowhere"',
  );
  expect(() => urgiisSoakTenants("")).toThrow("--urgiis-tenants names");
});

test("a URG IIS soak of chosen tenants crawls only them", async () => {
  const tenants = urgiisSoakTenants("mars");
  const scope = UrgiisCursor.initial(tenants).scope;
  expect(scope).not.toBe(UrgiisCursor.initial(URGIIS_TENANTS).scope);
  const result = await soakUrgiisInventory(
    async (cursor) => {
      expect(cursor.scope).toBe(scope);
      return {
        source: "urgiis",
        status: "complete",
        cursor,
        count: 0,
        pagesProcessed: 1,
        errors: [],
        warnings: [],
        observedVins: [],
        accounting: {
          recordsProcessed: 0,
          recordsExcluded: 0,
          recordsRejected: 0,
          duplicateVehicles: 0,
        },
      };
    },
    10,
    tenants,
  );
  expect(result.cursor.scope).toBe(scope);
});
