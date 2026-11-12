import { expect, test } from "bun:test";
import { transformIdipullRecord } from "./idipull-transform";
import { idipullTestRecord } from "./idipull-test-fixtures";

test("Idaho Falls preserves identity, native stock and row with a manual inventory destination", () => {
  const result = transformIdipullRecord(idipullTestRecord);
  expect(result).toMatchObject({
    status: "available",
    vehicle: {
      vin: idipullTestRecord.vin,
      year: 2008,
      make: "Chevrolet",
      model: "EXPRESS",
      stockNumber: "STK015489",
      row: "53",
      color: "Green",
      imageUrl: null,
      availableDate: null,
      detailsUrl: "https://ifipull.com/inventory/",
      lat: 43.523078,
      lng: -112.006206,
      stateAbbr: "ID",
    },
  });
});

test("Idaho Falls admits missing optional metadata and preserves genuine older serials", () => {
  const result = transformIdipullRecord({
    ...idipullTestRecord,
    year: "1973",
    make: "FORD",
    model: "MUSTANG",
    vin: "8532970167",
    stockNumber: "",
    row: "",
    color: "",
    arrivalDate: "",
  });
  expect(result).toMatchObject({
    status: "available",
    vehicle: {
      vin: "8532970167",
      year: 1973,
      stockNumber: null,
      row: null,
      color: null,
      imageUrl: null,
      availableDate: null,
    },
  });
});

test("Idaho Falls retains independently valid rejected VIN presence without inferring YMM", () => {
  expect(transformIdipullRecord({ ...idipullTestRecord, model: "" })).toEqual({
    status: "incomplete",
    vin: idipullTestRecord.vin,
  });
  expect(
    transformIdipullRecord({
      ...idipullTestRecord,
      year: "1985",
      vin: "CKR149F453385",
    }),
  ).toEqual({ status: "incomplete", vin: null });
});

test.each(["none", "null", "undefined", "---", "???"])(
  "Idaho Falls rejects required placeholders and nulls optional color (%s)",
  (value) => {
    for (const field of ["make", "model"] as const) {
      expect(
        transformIdipullRecord({ ...idipullTestRecord, [field]: value }),
      ).toEqual({
        status: "incomplete",
        vin: idipullTestRecord.vin,
      });
    }
    expect(
      transformIdipullRecord({ ...idipullTestRecord, color: value }),
    ).toMatchObject({
      status: "available",
      vehicle: { color: null },
    });
  },
);
