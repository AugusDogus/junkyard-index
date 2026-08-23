import { describe, expect, test } from "bun:test";
import { vehicle } from "~/schema";
import type { CanonicalVehicle } from "./types";
import {
  planChangedVehicleUpserts,
  planMissingVehicleTransitions,
  RECONCILIATION_SOURCE_PRIORITY,
  reconciliationSourcePrioritySql,
} from "./reconciliation-policy";

function canonicalVehicle(
  vin: string,
  overrides: Partial<CanonicalVehicle> = {},
): CanonicalVehicle {
  return {
    vin,
    source: "pyp",
    year: 2015,
    make: "FORD",
    model: "FOCUS",
    color: "Red",
    stockNumber: "A123",
    imageUrl: "https://example.com/car.jpg",
    availableDate: "2026-03-01T00:00:00.000Z",
    locationCode: "100",
    locationName: "Yard 100",
    locationCity: "Los Angeles",
    state: "California",
    stateAbbr: "CA",
    lat: 34.05,
    lng: -118.24,
    section: null,
    row: null,
    space: null,
    detailsUrl: "https://example.com/details",
    partsUrl: "https://example.com/parts",
    pricesUrl: "https://example.com/prices",
    engine: "2.0L",
    trim: "SE",
    transmission: "Automatic",
    ...overrides,
  };
}

function existingVehicle(
  vin: string,
  overrides: Partial<typeof vehicle.$inferSelect> = {},
): typeof vehicle.$inferSelect {
  return {
    ...canonicalVehicle(vin),
    firstSeenAt: new Date("2026-02-01T00:00:00.000Z"),
    lastSeenAt: new Date("2026-03-01T00:00:00.000Z"),
    missingSinceAt: null,
    missingRunCount: 0,
    ...overrides,
  };
}

describe("reconciliation policy", () => {
  test("defines one canonical provider priority for SQL reconciliation", () => {
    expect(RECONCILIATION_SOURCE_PRIORITY).toEqual([
      "row52",
      "pyp",
      "pullapart",
      "upullitne",
      "upullitdavie",
      "gopullit",
      "autorecycler",
    ]);
    expect(reconciliationSourcePrioritySql("candidate")).toContain(
      "case candidate.source",
    );
    expect(reconciliationSourcePrioritySql("candidate")).toContain(
      "when 'row52' then 1",
    );
    expect(reconciliationSourcePrioritySql("candidate")).toContain(
      "when 'autorecycler' then 7",
    );
  });

  test("treats a reappearing vehicle as changed", () => {
    const runTimestamp = new Date("2026-03-05T00:00:00.000Z");
    const changed = planChangedVehicleUpserts({
      inventory: new Map([["VIN123", canonicalVehicle("VIN123")]]),
      existingRows: [
        existingVehicle("VIN123", {
          missingSinceAt: new Date("2026-03-03T00:00:00.000Z"),
          missingRunCount: 2,
        }),
      ],
      runTimestamp,
    });

    expect(changed).toHaveLength(1);
    expect(changed[0]?.vehicle.vin).toBe("VIN123");
  });

  test("advances missing state only for accepted sources and deletes at the threshold", () => {
    const runTimestamp = new Date("2026-03-05T00:00:00.000Z");
    const transitions = planMissingVehicleTransitions({
      presentVins: new Set(["VIN_PRESENT"]),
      existingRows: [
        existingVehicle("VIN_PRESENT"),
        existingVehicle("VIN_MISSING"),
        existingVehicle("VIN_DELETE", {
          missingSinceAt: new Date("2026-03-01T00:00:00.000Z"),
          missingRunCount: 2,
        }),
        existingVehicle("VIN_UNHEALTHY", { source: "row52" }),
      ],
      runTimestamp,
      acceptedSources: new Set(["pyp"]),
      deleteAfterRuns: 3,
      deleteAfterMs: 3 * 24 * 60 * 60 * 1000,
    });

    expect(transitions).toEqual([
      {
        vin: "VIN_MISSING",
        changeType: "missing",
        missingSinceAt: runTimestamp.getTime(),
        missingRunCount: 1,
      },
      {
        vin: "VIN_DELETE",
        changeType: "delete",
        missingSinceAt: new Date("2026-03-01T00:00:00.000Z").getTime(),
        missingRunCount: 3,
      },
    ]);
  });
});
