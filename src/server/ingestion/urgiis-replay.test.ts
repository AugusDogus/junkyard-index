import { expect, test } from "bun:test";
import { Effect } from "effect";
import { Yard } from "~/lib/yard";
import { UrgiisTenant } from "./urgiis-tenant";
import { URGIIS_TENANTS } from "./urgiis-configuration";
import { UrgiisCursor } from "./urgiis-cursor";
import { streamUrgiisInventory } from "./urgiis-connector";
import { urgiisError } from "./urgiis-client";
import { UrgiisReplayArchive } from "./urgiis-replay-archive";

import { iisCards } from "./urgiis-catalog";
import { urgiisCoverageProbe, urgiisEquinoxProbe } from "./urgiis-route-probe";
import estimates from "../../../docs/runbooks/urgiis-incremental-estimates.json";
import type { ConnectorChunkAccounting } from "./connector-chunk";

const recoveredAccounting: Record<string, ConnectorChunkAccounting> = {
  eagle: {
    recordsProcessed: 2,
    recordsExcluded: 0,
    recordsRejected: 0,
    duplicateVehicles: 0,
  },
  "ace-st-paul": {
    recordsProcessed: 56,
    recordsExcluded: 0,
    recordsRejected: 0,
    duplicateVehicles: 1,
  },
  norbs: {
    recordsProcessed: 93,
    recordsExcluded: 2,
    recordsRejected: 5,
    duplicateVehicles: 0,
  },
  revolution: {
    recordsProcessed: 91,
    recordsExcluded: 0,
    recordsRejected: 1,
    duplicateVehicles: 0,
  },
  chucks: {
    recordsProcessed: 27,
    recordsExcluded: 2,
    recordsRejected: 3,
    duplicateVehicles: 0,
  },
};

for (const tenant of URGIIS_TENANTS) {
  test(
    `URG IIS validates the saved ${tenant.yard.name} census without partial publication`,
    async () => {
      const archive = await UrgiisReplayArchive.open(tenant.code);
      try {
        expect(archive.tenantCode).toBe(tenant.code);
        let reads = 0;
        let retries = 0;
        const emptyResponses = new Map<string, string>();
        const expected = estimates.outcomes.find(
          (o) => o.tenant === tenant.code,
        );
        if (!expected) throw new Error("Missing publish outcome");
        let batches = 0;
        let persistedAt = 0;
        let persistedPhase = "opening";
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
              now: Date.UTC(2026, 10, 17),
              readPage: (url) =>
                Effect.tryPromise({
                  try: async () => {
                    if (emptyResponses.has(url)) {
                      reads++;
                      retries++;
                      const recovered = urgiisCoverageProbe(tenant, url);
                      if (recovered) return recovered.html;
                      return tenant.code === "revolution"
                        ? urgiisEquinoxProbe().html
                        : (emptyResponses.get(url) ?? "");
                    }
                    const response = await archive.next();
                    reads++;
                    if (!response || response.url !== url)
                      throw new Error(
                        `Unexpected native request ${url} at ${reads}`,
                      );
                    if (
                      new URL(url).pathname.split("/").filter(Boolean)
                        .length === 3 &&
                      /No Results/i.test(response.html) &&
                      iisCards(response.html, tenant).nativeEmpty
                    )
                      emptyResponses.set(url, response.html);
                    return tenant.code !== "eagle"
                      ? (urgiisCoverageProbe(tenant, url)?.html ??
                          response.html)
                      : response.html;
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
                  expect(reads).toBe(archive.responseCount + retries);
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
          if (outcome._tag === "Left") throw new Error(outcome.left.message);
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
          // Keep chunk/resume and wire coverage while avoiding a multi-MiB
          // JSON roundtrip after every three saved seller-detail responses.
          // Small fixtures exercise every individual checkpoint boundary.
          cursor = result.cursor;
          if (
            cursor.requests - persistedAt >= 96 ||
            cursor.phase !== persistedPhase
          ) {
            cursor = UrgiisCursor.fromWire(
              UrgiisCursor.serialize(cursor, [tenant]),
              [tenant],
            );
            persistedAt = cursor.requests;
            persistedPhase = cursor.phase;
          }
        }
        if (expected.status === "blocked") {
          expect(batches).toBe(0);
          expect(count).toBe(0);
          expect(cursor.completed[0]).toHaveProperty("blocked");
          return;
        }
        expect(cursor.completed[0]).toHaveProperty("accepted");
        expect(batches).toBe(1);
        expect(count).toBe(expected.accepted);
        const added = recoveredAccounting[tenant.code];
        expect(accounting).toEqual({
          recordsProcessed:
            archive.expected.recordsProcessed + (added?.recordsProcessed ?? 0),
          recordsExcluded:
            archive.expected.recordsExcluded + (added?.recordsExcluded ?? 0),
          recordsRejected:
            archive.expected.recordsRejected + (added?.recordsRejected ?? 0),
          duplicateVehicles:
            archive.expected.duplicateVehicles +
            (added?.duplicateVehicles ?? 0),
        });
        expect(reads).toBe(archive.responseCount + retries);
        expect(byYard).toEqual(
          ["revolution", "ace-st-paul", "norbs", "eagle", "chucks"].includes(
            tenant.code,
          )
            ? { [tenant.yard.code]: expected.accepted }
            : archive.expected.byYard,
        );
        expect(await archive.next()).toBeUndefined();
      } finally {
        archive.close();
      }
    },
    tenant.attribution.kind === "seller" ? 600_000 : 120_000,
  );
}
