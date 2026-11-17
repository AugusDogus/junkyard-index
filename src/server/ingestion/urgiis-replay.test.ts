import { expect, test } from "bun:test";
import { Effect } from "effect";
import { Yard } from "~/lib/yard";
import { UrgiisTenant } from "./urgiis-tenant";
import { URGIIS_TENANTS } from "./urgiis-configuration";
import { UrgiisCursor } from "./urgiis-cursor";
import { streamUrgiisInventory } from "./urgiis-connector";
import { urgiisError } from "./urgiis-client";
import { UrgiisReplayArchive } from "./urgiis-replay-archive";

// These original captures contain proven enumeration gaps. Keep their raw
// evidence and require the connector to stop at the exact badged empty page.
const incomplete = new Map([
  ["eagle", { path: "/parts/CHRYSLER/TOWN_-and_COUNTRY/", count: 6 }],
  ["linders", { path: "/parts/CHRYSLER/TOWN_-and_COUNTRY/", count: 2 }],
  ["chuckran", { path: "/parts/CHRYSLER/TOWN_-and_COUNTRY/", count: 3 }],
  ["united", { path: "/parts/CHRYSLER/TOWN_-and_COUNTRY/", count: 29 }],
  ["ace-iowa", { path: "/parts/CHRYSLER/TOWN_-and_COUNTRY/", count: 5 }],
  ["lentini", { path: "/parts/CHRYSLER/TOWN_-and_COUNTRY/", count: 6 }],
  ["dings", { path: "/parts/CHRYSLER/TOWN_-and_COUNTRY/", count: 2 }],
  ["ace-st-paul", { path: "/parts/CHRYSLER/TOWN_-and_COUNTRY/", count: 54 }],
  ["chucks", { path: "/parts/CHEVROLET/CHEVROLET_PASS./", count: 2 }],
  ["central-nh", { path: "/parts/CHRYSLER/TOWN_-and_COUNTRY/", count: 11 }],
  ["higgins", { path: "/parts/CHRYSLER/TOWN_-and_COUNTRY/", count: 6 }],
  ["premier", { path: "/parts/CHRYSLER/TOWN_-and_COUNTRY/", count: 9 }],
  [
    "junior-sinn",
    { path: "/parts/CHEVROLET/BLAZER.JIMMY_(FULL_SIZE)/", count: 2 },
  ],
  ["revolution", { path: "/parts/CHEVROLET/EQUINOX/", count: 91 }],
  ["az", { path: "/parts/CHRYSLER/TOWN_-and_COUNTRY/", count: 2 }],
  ["lambert", { path: "/parts/CHRYSLER/TOWN_-and_COUNTRY/", count: 13 }],
  ["norbs", { path: "/parts/CHEVROLET/BLAZER.JIMMY_(FULL_SIZE)/", count: 3 }],
]);

for (const tenant of URGIIS_TENANTS) {
  test(
    `URG IIS validates the saved ${tenant.yard.name} census without partial publication`,
    async () => {
      const archive = await UrgiisReplayArchive.open(tenant.code);
      try {
        expect(archive.tenantCode).toBe(tenant.code);
        let reads = 0;
        let batches = 0;
        let cursor = UrgiisCursor.initial([tenant]);
        let count = 0;
        const byYard: Record<string, number> = {};
        const accounting = {
          recordsProcessed: 0,
          recordsExcluded: 0,
          recordsRejected: 0,
          duplicateVehicles: 0,
        };
        while (cursor.phase !== "complete") {
          const outcome = await Effect.runPromise(
            streamUrgiisInventory({
              tenants: [tenant],
              startCursor: cursor,
              maxPages: 3,
              readPage: (url) =>
                Effect.tryPromise({
                  try: async () => {
                    const response = await archive.next();
                    reads++;
                    if (!response || response.url !== url)
                      throw new Error(
                        `Unexpected native request ${url} at ${reads}`,
                      );
                    return response.html;
                  },
                  catch: (cause) => urgiisError("offline replay", cause),
                }),
              onYards: (yards) =>
                Effect.sync(() => {
                  for (const yard of yards)
                    expect(Yard.parse(yard).success).toBe(true);
                }),
              onBatch: (vehicles) =>
                Effect.sync(() => {
                  expect(reads).toBe(archive.responseCount);
                  expect(new Set(vehicles.map((v) => v.vin)).size).toBe(
                    vehicles.length,
                  );
                  for (const donor of vehicles) {
                    expect(donor.source).toBe("urgiis");
                    const yard = UrgiisTenant.yards(tenant).find(
                      (y) => y.code === donor.locationCode,
                    );
                    if (!yard)
                      throw new Error(
                        "Unqualified physical yard: " + donor.locationCode,
                      );
                    expect(donor.lat).toBe(yard.lat);
                    expect(donor.lng).toBe(yard.lng);
                    expect(donor.stateAbbr).toBe(yard.state);
                    byYard[yard.code] = (byYard[yard.code] ?? 0) + 1;
                    if (
                      donor.detailsUrl !==
                      tenant.origin + tenant.arrivalsPath
                    )
                      expect(donor.detailsUrl).toStartWith(
                        tenant.origin + "/" + tenant.pathStyle + "/",
                      );
                  }
                  batches++;
                }),
            }).pipe(Effect.either),
          );
          if (outcome._tag === "Left") {
            const expected = incomplete.get(tenant.code);
            if (!expected) throw new Error(outcome.left.message);
            expect(outcome.left.operation).toBe(
              "parse " + tenant.origin + expected.path,
            );
            expect(outcome.left.message).toContain(
              `advertises ${expected.count} donors but returns an explicit empty result`,
            );
            expect(batches).toBe(0);
            expect(count).toBe(0);
            return;
          }
          const result = outcome.right;
          if (result.status === "failed")
            throw new Error(result.errors.join("; "));
          count += result.count;
          for (const key of [
            "recordsProcessed",
            "recordsExcluded",
            "recordsRejected",
            "duplicateVehicles",
          ] as const)
            accounting[key] += result.accounting[key];
          cursor = UrgiisCursor.fromWire(
            UrgiisCursor.serialize(result.cursor, [tenant]),
            [tenant],
          );
        }
        expect(incomplete.has(tenant.code)).toBe(false);
        expect(batches).toBe(1);
        expect(count).toBe(archive.expected.accepted);
        expect(accounting).toEqual({
          recordsProcessed: archive.expected.recordsProcessed,
          recordsExcluded: archive.expected.recordsExcluded,
          recordsRejected: archive.expected.recordsRejected,
          duplicateVehicles: archive.expected.duplicateVehicles,
        });
        expect(reads).toBe(archive.responseCount);
        expect(byYard).toEqual(archive.expected.byYard);
        expect(await archive.next()).toBeUndefined();
      } finally {
        archive.close();
      }
    },
    tenant.attribution.kind === "seller" ? 600_000 : 120_000,
  );
}
