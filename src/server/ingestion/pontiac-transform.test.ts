import { expect, test } from "bun:test";
import { PontiacDetailSchema, PontiacSearchSchema } from "./pontiac-record";
import { transformPontiacRecord } from "./pontiac-transform";
import {
  pontiacDetailRecord,
  pontiacSearchRecord,
} from "./pontiac-test-fixtures";

function transform(
  detail: unknown = pontiacDetailRecord,
  search: unknown = pontiacSearchRecord,
) {
  return transformPontiacRecord(
    PontiacSearchSchema.parse(search),
    PontiacDetailSchema.parse(detail),
  );
}

test("Pontiac retains source donor fields and leaves unpublished specifications null", () => {
  const result = transform();
  expect(result.status).toBe("available");
  if (result.status !== "available")
    throw new Error("Expected complete Pontiac donor");
  expect(result.vehicle).toMatchObject({
    source: "pontiac",
    vin: pontiacDetailRecord.VIN,
    year: 2007,
    make: "Nissan",
    model: "ARMADA",
    color: "Red",
    stockNumber: "P52089",
    row: "16",
    availableDate: "2026-01-10T08:31:12.107Z",
    detailsUrl: "https://u-pullandsave.com/vehicles/15918204",
    imageUrl: pontiacDetailRecord.images[0]?.imageMedium,
    locationCode: "105",
    stateAbbr: "MI",
    lat: 42.6684624,
    lng: -83.2932624,
    engine: null,
    trim: null,
    transmission: null,
    section: null,
    space: null,
  });
});

test.each([null, undefined])(
  "Pontiac admits donors without optional metadata: %j",
  (missing) => {
    const result = transform(
      {
        ...pontiacDetailRecord,
        stockID: missing,
        colorOfVehicle: missing,
        YardRow: missing,
        YardLocationDT: missing,
        images: missing,
      },
      {
        ...pontiacSearchRecord,
        stockID: missing,
        colorOfVehicle: missing,
        yardRow: missing,
      },
    );
    expect(result.status).toBe("available");
    if (result.status !== "available")
      throw new Error("Expected donor with nullable optional metadata");
    expect(result.vehicle).toMatchObject({
      color: null,
      stockNumber: null,
      row: null,
      availableDate: null,
      imageUrl: null,
    });
  },
);

test("Pontiac preserves known search metadata when detail metadata is absent", () => {
  const result = transform({
    ...pontiacDetailRecord,
    stockID: null,
    colorOfVehicle: null,
    YardRow: null,
    images: [],
  });
  expect(result.status).toBe("available");
  if (result.status !== "available")
    throw new Error("Expected donor with native search metadata");
  expect(result.vehicle).toMatchObject({
    color: "Red",
    stockNumber: "P52089",
    row: "16",
    imageUrl: null,
  });
});

test("Pontiac preserves detail metadata when search omits optional fields", () => {
  const result = transform(pontiacDetailRecord, {
    ...pontiacSearchRecord,
    stockID: undefined,
    colorOfVehicle: undefined,
    yardRow: undefined,
  });
  expect(result.status).toBe("available");
  if (result.status !== "available")
    throw new Error("Expected donor with native detail metadata");
  expect(result.vehicle).toMatchObject({
    color: "Red",
    stockNumber: "P52089",
    row: "16",
  });
});

test.each(["2026-02-30T00:00:00Z", "2099-01-01T00:00:00Z"])(
  "Pontiac leaves unusable optional dates null: %s",
  (YardLocationDT) => {
    const result = transform({ ...pontiacDetailRecord, YardLocationDT });
    expect(result.status).toBe("available");
    if (result.status !== "available")
      throw new Error("Expected donor without a usable date");
    expect(result.vehicle.availableDate).toBeNull();
  },
);

test("Pontiac leaves unknown native colors null", () => {
  const result = transform(
    { ...pontiacDetailRecord, colorOfVehicle: "UNKNOWN" },
    { ...pontiacSearchRecord, colorOfVehicle: "UNKNOWN" },
  );
  expect(result.status).toBe("available");
  if (result.status !== "available")
    throw new Error("Expected donor without a known color");
  expect(result.vehicle.color).toBeNull();
});

test.each([
  { VIN: "invalid" },
  {
    images: [
      {
        referenceID: 1,
        imageMedium: pontiacDetailRecord.images[0]?.imageMedium,
      },
    ],
  },
  {
    images: [
      {
        referenceID: pontiacDetailRecord.vehicleID,
        imageMedium: "https://static.u-pullandsave.com/medium/placeholder.jpg",
      },
    ],
  },
])("Pontiac excludes incomplete donors: %j", (patch) => {
  const result = transform({ ...pontiacDetailRecord, ...patch });
  expect(result.status).toBe("incomplete");
});

test.each([
  { vehicleID: 1 },
  { stockID: "P52090" },
  { modelYear: 2008 },
  { vehicleMake: "HONDA" },
  { modelName: "PATHFINDER" },
  { colorOfVehicle: "BLUE" },
  { YardRow: 17 },
])("Pontiac fails contradictory search/detail identity: %j", (patch) => {
  expect(() => transform({ ...pontiacDetailRecord, ...patch })).toThrow(
    "disagree",
  );
});

test("Pontiac rejects another store and explicitly excludes unavailable donors", () => {
  expect(() =>
    transform({ ...pontiacDetailRecord, storeNumber: 106 }),
  ).toThrow();
  expect(transform({ ...pontiacDetailRecord, YardLocation: "SOLD" })).toEqual({
    status: "unavailable",
  });
});
