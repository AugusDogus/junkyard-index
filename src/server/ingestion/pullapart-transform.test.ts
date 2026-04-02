import { describe, expect, test } from "bun:test";
import type {
  PullapartLocation,
  PullapartVehicle,
  PullapartVehicleExtendedInfo,
  PullapartZipGeo,
} from "./pullapart-client";
import { transformPullapartVehicle } from "./pullapart-transform";

const location: PullapartLocation = {
  idNumber: 3,
  nameItem: "Atlanta South",
  locationID: 3,
  locationName: "Atlanta South",
  address1: "1540 Henrico Road",
  address2: "",
  cityName: "Conley",
  stateName: "GA",
  zipCode: "30288",
  siteTypeID: 3,
  phone: "770-242-8844",
  phoneCarBuying: "770-800-3118",
  phoneUsedCar: "404-600-1307",
  distanceInMiles: 0,
  taxRate: 0.08,
  warrantyDays: 32,
  coreDays: 32,
  allowsCashReturns: 0,
  email: "Atlanta@pullapart.com",
  passcodeForMiscItems: false,
  retailEmail: "atl1Retail@pullapart.com",
  environmentalFeeRate: 0.1,
  environmentalFeeCap: 1000000,
  locationShortName: "atl1",
};

const geo: PullapartZipGeo = {
  lat: 33.6477,
  lng: -84.3372,
};

const vehicle: PullapartVehicle = {
  vinID: 1236492,
  ticketID: 1191613,
  lineID: 12,
  locID: 3,
  locName: "Atlanta South",
  makeID: 6,
  makeName: "ACURA",
  modelID: 10,
  modelName: "MDX",
  modelYear: 2006,
  row: 304,
  vin: "2HNYD18866H537719",
  dateYardOn: "2026-01-22T12:46:20.98",
  vinDecodedId: 13226,
  extendedInfo: null,
};

describe("transformPullapartVehicle", () => {
  test("uses detail and image enrichment for canonical fields", () => {
    const detail: PullapartVehicleExtendedInfo = {
      trim: "Touring w/Navi",
      driveType: "AWD",
      fuelType: "G",
      engineBlock: "V",
      engineCylinders: 6,
      engineSize: 3.5,
      engineAspiration: "N/A",
      transType: "A",
      transSpeeds: 5,
      style: "AWD Touring 4dr SUV w/Navi",
      color: "BLACK",
    };

    const result = transformPullapartVehicle(vehicle, location, geo, {
      detail,
      imageUrl:
        "https://papimages.blob.core.windows.net/carinventory/3/2026/01/20260122131716_3_1191613_12.png",
    });

    expect(result).not.toBeNull();
    expect(result?.color).toBe("Black");
    expect(result?.imageUrl).toBe(
      "https://papimages.blob.core.windows.net/carinventory/3/2026/01/20260122131716_3_1191613_12.png",
    );
    expect(result?.availableDate).toBe("2026-01-22T00:00:00.000Z");
    expect(result?.locationName).toBe("Atlanta South");
    expect(result?.locationCity).toBe("Conley");
    expect(result?.state).toBe("Georgia");
    expect(result?.stateAbbr).toBe("GA");
    expect(result?.row).toBe("304");
    expect(result?.trim).toBe("Touring w/Navi");
    expect(result?.engine).toBe("3.5L V6");
    expect(result?.transmission).toBe("5-Speed Automatic");
  });

  test("falls back to extendedInfo and returns null for invalid dates", () => {
    const result = transformPullapartVehicle(
      {
        ...vehicle,
        dateYardOn: "not-a-date",
        extendedInfo: {
          color: "silver",
          trim: "Base",
          transmissionDescription: "Automatic",
        },
      },
      location,
      geo,
    );

    expect(result).not.toBeNull();
    expect(result?.availableDate).toBeNull();
    expect(result?.color).toBe("Silver");
    expect(result?.trim).toBe("Base");
    expect(result?.transmission).toBe("Automatic");
  });
});
