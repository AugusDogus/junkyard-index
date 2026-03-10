import { describe, expect, test } from "bun:test";
import { vehicle } from "~/schema";
import {
  mapDbVehicleToCanonical,
  partitionVehicleChanges,
} from "./algolia-projector";

describe("algolia-projector helpers", () => {
  test("maps a database vehicle row to canonical shape", () => {
    const row: typeof vehicle.$inferSelect = {
      vin: "VIN123",
      source: "row52",
      year: 2019,
      make: "HONDA",
      model: "CIVIC",
      color: "Blue",
      stockNumber: "ABC123",
      imageUrl: "https://example.com/car.jpg",
      availableDate: "2026-02-01T00:00:00.000Z",
      locationCode: "42",
      locationName: "Sacramento",
      state: "California",
      stateAbbr: "CA",
      lat: 38.58,
      lng: -121.49,
      section: null,
      row: "A",
      space: "12",
      detailsUrl: "https://example.com/details",
      partsUrl: "https://example.com/parts",
      pricesUrl: "https://example.com/prices",
      engine: "2.0L",
      trim: "EX",
      transmission: "Automatic",
      firstSeenAt: new Date("2026-02-01T00:00:00.000Z"),
      lastSeenAt: new Date("2026-02-01T00:00:00.000Z"),
      missingSinceAt: null,
      missingRunCount: 0,
    };

    expect(mapDbVehicleToCanonical(row)).toEqual({
      vin: "VIN123",
      source: "row52",
      year: 2019,
      make: "HONDA",
      model: "CIVIC",
      color: "Blue",
      stockNumber: "ABC123",
      imageUrl: "https://example.com/car.jpg",
      availableDate: "2026-02-01T00:00:00.000Z",
      locationCode: "42",
      locationName: "Sacramento",
      state: "California",
      stateAbbr: "CA",
      lat: 38.58,
      lng: -121.49,
      section: null,
      row: "A",
      space: "12",
      detailsUrl: "https://example.com/details",
      partsUrl: "https://example.com/parts",
      pricesUrl: "https://example.com/prices",
      engine: "2.0L",
      trim: "EX",
      transmission: "Automatic",
    });
  });

  test("partitions delete and upsert vins by change type", () => {
    const changes = [
      { id: 1, vin: "VIN-DELETE-1", changeType: "delete" },
      { id: 2, vin: "VIN-UPSERT-1", changeType: "upsert" },
      { id: 3, vin: "VIN-MISSING-1", changeType: "missing" },
      { id: 4, vin: "VIN-DELETE-2", changeType: "delete" },
    ];

    expect(partitionVehicleChanges(changes)).toEqual({
      deleteVins: ["VIN-DELETE-1", "VIN-DELETE-2"],
      upsertVins: ["VIN-UPSERT-1", "VIN-MISSING-1"],
    });
  });
});
