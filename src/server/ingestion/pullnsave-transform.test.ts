import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  PullNSaveSearchPageSchema,
  PullNSaveVehicleSchema,
} from "./pullnsave-client";
import mediaSamples from "./fixtures/pullnsave-media-samples.json";
import { PULLNSAVE_YARDS } from "./pullnsave-config";
import { transformPullNSaveVehicle } from "./pullnsave-transform";
import { algoliaHitToSearchVehicle } from "~/lib/search-vehicles";
import { toAlgoliaRecord } from "./types";

function decodeRecord(raw: unknown) {
  return Schema.decodeUnknownSync(PullNSaveVehicleSchema)(raw);
}

const VALID_RECORD = decodeRecord({
  astStoreNumber: 5,
  vehicleRno: 44858,
  storeRno: 1,
  stockId: "STK044481-5",
  rcvdDtTm: "2026-08-20T12:30:00",
  vin: "2g1wu581769248827",
  year: 2006,
  make: "CHEVROLET",
  model: "IMPALA",
  color: "SILVER",
  transmissionDesc: null,
  engineDesc: null,
  yardRow: 50,
});

const GILBERT = PULLNSAVE_YARDS.find((yard) => yard.yardNumber === 5);

describe("transformPullNSaveVehicle", () => {
  test("preserves live yard-qualified photos through projection and search conversion", () => {
    const records = Schema.decodeUnknownSync(PullNSaveSearchPageSchema)(
      mediaSamples,
    );
    for (const record of records) {
      const yard = PULLNSAVE_YARDS.find(
        (yard) => yard.yardNumber === record.astStoreNumber,
      );
      if (!yard)
        throw new Error(`Missing sample yard ${record.astStoreNumber}`);
      const vehicle = transformPullNSaveVehicle(record, yard);
      if (!vehicle) throw new Error(`Invalid live sample ${record.stockId}`);
      const searchVehicle = algoliaHitToSearchVehicle(
        toAlgoliaRecord(vehicle, new Date(), null, 0),
      );
      expect(searchVehicle?.vin).toBe(vehicle.vin);
      expect(searchVehicle?.imageUrl).toBe(
        `https://app.pullnsaveapp.com/v1/Vehicles/Images/StockId/${record.stockId}/OrderId/1`,
      );
    }
  });

  test("does not fabricate an image URL for a blank stock ID", () => {
    if (!GILBERT) throw new Error("Missing Gilbert fixture yard");
    const vehicle = transformPullNSaveVehicle(
      decodeRecord({ ...VALID_RECORD, stockId: "  " }),
      GILBERT,
    );
    expect(vehicle?.stockNumber).toBeNull();
    expect(vehicle?.imageUrl).toBeNull();
  });

  test("preserves the generic inventory fallback through projection and search conversion", () => {
    if (!GILBERT) throw new Error("Missing Gilbert fixture yard");
    const vehicle = transformPullNSaveVehicle(VALID_RECORD, GILBERT);
    if (!vehicle) throw new Error("Expected a canonical vehicle");
    const searchVehicle = algoliaHitToSearchVehicle(
      toAlgoliaRecord(vehicle, new Date(), null, 0),
    );
    // This is only a search form, not a vehicle destination. See the media/link audit runbook.
    expect(searchVehicle?.detailsUrl).toBe(
      "https://www.pullnsave.com/inventory/",
    );
    expect(searchVehicle?.imageUrl).toBe(vehicle.imageUrl);
  });
  test("maps a complete record into the canonical shape", () => {
    expect(GILBERT).not.toBeNull();
    const vehicle = transformPullNSaveVehicle(
      VALID_RECORD,
      GILBERT as NonNullable<typeof GILBERT>,
    );

    expect(vehicle).toEqual({
      vin: "2G1WU581769248827",
      source: "pullnsave",
      year: 2006,
      make: "Chevrolet",
      model: "IMPALA",
      color: "Silver",
      stockNumber: "STK044481-5",
      imageUrl:
        "https://app.pullnsaveapp.com/v1/Vehicles/Images/StockId/STK044481-5/OrderId/1",
      availableDate: new Date("2026-08-20T12:30:00").toISOString(),
      locationCode: "PNS-GILBERT",
      locationName: "Pull N Save - Gilbert",
      locationCity: "Gilbert",
      state: "Arizona",
      stateAbbr: "AZ",
      lat: GILBERT?.lat ?? 0,
      lng: GILBERT?.lng ?? 0,
      section: null,
      row: "50",
      space: null,
      detailsUrl: "https://www.pullnsave.com/inventory/",
      partsUrl: null,
      pricesUrl: null,
      engine: null,
      trim: null,
      transmission: null,
    });
  });

  test("returns null for a missing VIN", () => {
    const record = decodeRecord({ ...VALID_RECORD, vin: null });
    expect(transformPullNSaveVehicle(record, GILBERT!)).toBeNull();
  });

  test("returns null for a blank VIN", () => {
    const record = decodeRecord({ ...VALID_RECORD, vin: "   " });
    expect(transformPullNSaveVehicle(record, GILBERT!)).toBeNull();
  });

  test("returns null for a missing or non-positive year", () => {
    expect(
      transformPullNSaveVehicle(
        decodeRecord({ ...VALID_RECORD, year: null }),
        GILBERT!,
      ),
    ).toBeNull();
    expect(
      transformPullNSaveVehicle(
        decodeRecord({ ...VALID_RECORD, year: 0 }),
        GILBERT!,
      ),
    ).toBeNull();
  });

  test("returns null for a missing model", () => {
    const record = decodeRecord({ ...VALID_RECORD, model: "" });
    expect(transformPullNSaveVehicle(record, GILBERT!)).toBeNull();
  });

  test("normalizes color aliases and blanks", () => {
    const gry = transformPullNSaveVehicle(
      decodeRecord({ ...VALID_RECORD, color: "GRY" }),
      GILBERT!,
    );
    expect(gry?.color).toBe("Gray");

    const unknown = transformPullNSaveVehicle(
      decodeRecord({ ...VALID_RECORD, color: "UNKNOWN" }),
      GILBERT!,
    );
    expect(unknown?.color).toBeNull();
  });

  test("keeps engine and transmission descriptions when present", () => {
    const vehicle = transformPullNSaveVehicle(
      decodeRecord({
        ...VALID_RECORD,
        engineDesc: "3.5L V6",
        transmissionDesc: "Automatic",
      }),
      GILBERT!,
    );
    expect(vehicle?.engine).toBe("3.5L V6");
    expect(vehicle?.transmission).toBe("Automatic");
  });

  test("parses received dates and rejects malformed ones", () => {
    const valid = transformPullNSaveVehicle(
      decodeRecord({ ...VALID_RECORD, rcvdDtTm: "2022-11-03T10:37:00" }),
      GILBERT!,
    );
    expect(valid?.availableDate).toBe(
      new Date("2022-11-03T10:37:00").toISOString(),
    );

    const invalid = transformPullNSaveVehicle(
      decodeRecord({ ...VALID_RECORD, rcvdDtTm: "not-a-date" }),
      GILBERT!,
    );
    expect(invalid?.availableDate).toBeNull();

    const missing = transformPullNSaveVehicle(
      decodeRecord({ ...VALID_RECORD, rcvdDtTm: null }),
      GILBERT!,
    );
    expect(missing?.availableDate).toBeNull();
  });
});
