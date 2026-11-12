import { expect, test } from "bun:test";
import { transformArmyRecord } from "./army-transform";
import { armyTestRecord } from "./army-test-fixtures";

test("Army preserves native stock leading zeroes and accepts absent optional metadata", () => {
  expect(
    transformArmyRecord({ ...armyTestRecord, color: "N/A" }),
  ).toMatchObject({
    status: "available",
    vehicle: {
      vin: armyTestRecord.vin,
      stockNumber: "000000003739",
      color: null,
      imageUrl: null,
      availableDate: null,
      row: null,
      section: null,
      space: null,
    },
  });
});

test("Army accepts eligible older native serials and rejects post-1980 short identities without correcting years", () => {
  expect(
    transformArmyRecord({
      ...armyTestRecord,
      year: "1972",
      make: "CADILLAC",
      model: "ELDORADO",
      vin: "6L47S2Q422543",
    }),
  ).toMatchObject({
    status: "available",
    vehicle: { year: 1972, vin: "6L47S2Q422543", make: "Cadillac" },
  });
  for (const [year, vin] of [
    ["1988", "CCR3374108371"],
    ["2002", "F44CF7V002642"],
    ["2008", "731DH7120861"],
  ]) {
    expect(
      transformArmyRecord({
        ...armyTestRecord,
        year: year ?? "",
        vin: vin ?? "",
      }),
    ).toEqual({ status: "incomplete", vin: null });
  }
});

test("Army preserves valid rejected VINs as presence evidence and never invents optional metadata", () => {
  expect(transformArmyRecord({ ...armyTestRecord, model: "" })).toEqual({
    status: "incomplete",
    vin: armyTestRecord.vin,
  });
  expect(
    transformArmyRecord({ ...armyTestRecord, stock: "", color: "UNKNOWN" }),
  ).toMatchObject({
    status: "available",
    vehicle: {
      stockNumber: null,
      color: null,
      imageUrl: null,
      availableDate: null,
    },
  });
});

test.each(["-", "NULL", "N-A", "None", "UNKNOWN", "Other", "000"])(
  "Army rejects placeholder required descriptions %s",
  (value) => {
    expect(transformArmyRecord({ ...armyTestRecord, make: value })).toEqual({
      status: "incomplete",
      vin: armyTestRecord.vin,
    });
    expect(transformArmyRecord({ ...armyTestRecord, model: value })).toEqual({
      status: "incomplete",
      vin: armyTestRecord.vin,
    });
  },
);

test("Army rejects numeric-only make descriptions", () => {
  expect(transformArmyRecord({ ...armyTestRecord, make: "123" })).toEqual({
    status: "incomplete",
    vin: armyTestRecord.vin,
  });
});

test.each(["NULL", "0", "--", "N/A", "Unknown"])(
  "Army nulls unusable optional stock and color %s",
  (value) => {
    expect(
      transformArmyRecord({ ...armyTestRecord, stock: value, color: value }),
    ).toMatchObject({
      status: "available",
      vehicle: { stockNumber: null, color: null },
    });
  },
);
