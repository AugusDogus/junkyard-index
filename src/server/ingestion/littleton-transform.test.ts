import { expect, test } from "bun:test";
import { littletonTestRecord } from "./littleton-test-fixtures";
import { transformLittletonRecord } from "./littleton-transform";

test("Littleton preserves the whole API YMM, source values and calendar arrival date", () => {
  expect(transformLittletonRecord(littletonTestRecord)).toMatchObject({
    status: "available",
    vehicle: {
      vin: littletonTestRecord.vin,
      year: 2005,
      make: "Acura",
      model: "MDX",
      color: "Black",
      stockNumber: "STK056374",
      row: "35",
      availableDate: "2026-11-04",
      imageUrl: null,
      locationCity: "Littleton",
      stateAbbr: "CO",
      lat: 39.48691,
      lng: -104.99796,
      detailsUrl: "https://littletonupullit.com/vehicle-inventory",
    },
  });
});
test.each([undefined, null, "", false, {}, "Unknown", "N/A"])(
  "Littleton nulls unusable optional fields (%#)",
  (value) => {
    expect(
      transformLittletonRecord({
        ...littletonTestRecord,
        color: value,
        vehicleRow: value,
        dateAdded: value,
        imageUrl: value,
        imageUrls: value,
      }),
    ).toMatchObject({
      status: "available",
      vehicle: { color: null, row: null, availableDate: null, imageUrl: null },
    });
  },
);
test.each([
  "2026-02-30T12:00:00",
  "2026-11-04T25:00:00",
  "2026-11-04T12:60:00",
  "11/04/2026",
  "2026-11-04T12:00:00Z",
])("Littleton never invents dates or instants from %s", (dateAdded) => {
  expect(
    transformLittletonRecord({ ...littletonTestRecord, dateAdded }),
  ).toMatchObject({ status: "available", vehicle: { availableDate: null } });
});
test("Littleton retains supported pre-1981 serials and valid rejected identity presence", () => {
  expect(
    transformLittletonRecord({
      ...littletonTestRecord,
      year: 1977,
      vin: "1234567890ABC",
    }),
  ).toMatchObject({ status: "available", vehicle: { vin: "1234567890ABC" } });
  expect(
    transformLittletonRecord({ ...littletonTestRecord, model: "Unknown" }),
  ).toEqual({ status: "incomplete", vin: littletonTestRecord.vin });
  expect(
    transformLittletonRecord({ ...littletonTestRecord, vin: "INVALID" }),
  ).toEqual({ status: "incomplete", vin: null });
});
