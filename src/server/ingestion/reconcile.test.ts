import { describe, expect, test } from "bun:test";
import { vehicle } from "~/schema";
import type { CanonicalVehicle } from "./types";
import { buildFinalInventoryByVin, createReconcilePlan } from "./reconcile";

function makeCanonicalVehicle(
  vin: string,
  source: CanonicalVehicle["source"],
  overrides: Partial<CanonicalVehicle> = {},
): CanonicalVehicle {
  return {
    vin,
    source,
    year: 2015,
    make: "FORD",
    model: "FOCUS",
    color: "Red",
    stockNumber: "A123",
    imageUrl: "https://example.com/car.jpg",
    availableDate: "2026-03-01T00:00:00.000Z",
    locationCode: "100",
    locationName: "Yard 100",
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

function makeExistingVehicle(
  vin: string,
  overrides: Partial<typeof vehicle.$inferSelect> = {},
): typeof vehicle.$inferSelect {
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
    firstSeenAt: new Date("2026-02-01T00:00:00.000Z"),
    lastSeenAt: new Date("2026-03-01T00:00:00.000Z"),
    missingSinceAt: null,
    missingRunCount: 0,
    ...overrides,
  };
}

describe("reconcile helpers", () => {
  test("prefers Row52 when both sources are healthy", () => {
    const pypVehicle = makeCanonicalVehicle("VIN123", "pyp", {
      color: "Blue",
      stockNumber: "PYP-1",
    });
    const row52Vehicle = makeCanonicalVehicle("VIN123", "row52", {
      color: "Black",
      stockNumber: "R52-1",
    });

    const finalInventory = buildFinalInventoryByVin({
      healthySources: ["row52", "pyp"],
      row52ByVin: new Map([[row52Vehicle.vin, row52Vehicle]]),
      pypByVin: new Map([[pypVehicle.vin, pypVehicle]]),
    });

    expect(finalInventory.get("VIN123")).toEqual(row52Vehicle);
  });

  test("keeps PYP data when Row52 is unhealthy", () => {
    const pypVehicle = makeCanonicalVehicle("VIN123", "pyp", {
      color: "Blue",
      stockNumber: "PYP-1",
    });
    const row52Vehicle = makeCanonicalVehicle("VIN123", "row52", {
      color: "Black",
      stockNumber: "R52-1",
    });

    const finalInventory = buildFinalInventoryByVin({
      healthySources: ["pyp"],
      row52ByVin: new Map([[row52Vehicle.vin, row52Vehicle]]),
      pypByVin: new Map([[pypVehicle.vin, pypVehicle]]),
    });

    expect(finalInventory.get("VIN123")).toEqual(pypVehicle);
  });

  test("treats reappearing vehicles as changed so missing state is cleared", () => {
    const runTimestamp = new Date("2026-03-05T00:00:00.000Z");
    const finalInventory = new Map([
      ["VIN123", makeCanonicalVehicle("VIN123", "pyp")],
    ]);

    const plan = createReconcilePlan({
      finalInventoryByVin: finalInventory,
      existingVehicles: [
        makeExistingVehicle("VIN123", {
          missingSinceAt: new Date("2026-03-03T00:00:00.000Z"),
          missingRunCount: 2,
        }),
      ],
      runTimestamp,
      allowAdvanceMissingState: true,
      missingDeleteAfterRuns: 3,
      missingDeleteAfterMs: 3 * 24 * 60 * 60 * 1000,
    });

    expect(plan.changedUpserts).toHaveLength(1);
    expect(plan.changedUpserts[0]?.vehicle.vin).toBe("VIN123");
    expect(plan.missingTransitions).toHaveLength(0);
  });

  test("marks missing vehicles and deletes rows that cross the threshold", () => {
    const runTimestamp = new Date("2026-03-05T00:00:00.000Z");
    const existingVehicles = [
      makeExistingVehicle("VIN_MISSING"),
      makeExistingVehicle("VIN_DELETE", {
        missingSinceAt: new Date("2026-03-01T00:00:00.000Z"),
        missingRunCount: 2,
      }),
    ];

    const plan = createReconcilePlan({
      finalInventoryByVin: new Map(),
      existingVehicles,
      runTimestamp,
      allowAdvanceMissingState: true,
      missingDeleteAfterRuns: 3,
      missingDeleteAfterMs: 3 * 24 * 60 * 60 * 1000,
    });

    expect(plan.changedUpserts).toHaveLength(0);
    expect(plan.missingTransitions).toEqual([
      {
        vin: "VIN_MISSING",
        changeType: "missing",
        missingSinceAt: runTimestamp,
        missingRunCount: 1,
      },
      {
        vin: "VIN_DELETE",
        changeType: "delete",
        missingSinceAt: new Date("2026-03-01T00:00:00.000Z"),
        missingRunCount: 3,
      },
    ]);
    expect(plan.deleteVins).toEqual(["VIN_DELETE"]);
  });
});
