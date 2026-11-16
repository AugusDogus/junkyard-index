import { expect, test } from "bun:test";
import { Effect } from "effect";
import { Yard } from "~/lib/yard";
import { UrgiisTenant } from "./urgiis-tenant";
import { URGIIS_TENANTS } from "./urgiis-configuration";
import { UrgiisCursor } from "./urgiis-cursor";
import { streamUrgiisInventory } from "./urgiis-connector";
import { urgiisError } from "./urgiis-client";
import { UrgiisReplayArchive } from "./urgiis-replay-archive";

for (const tenant of URGIIS_TENANTS) {
  test(
    `URG IIS replays the complete saved ${tenant.yard.name} census`,
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
          const result = await Effect.runPromise(
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
                    expect(donor.detailsUrl).toStartWith(
                      tenant.origin + "/" + tenant.pathStyle + "/",
                    );
                  }
                  batches++;
                }),
            }),
          );
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
