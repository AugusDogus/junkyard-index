import { expect, test } from "bun:test";
import { transformDdautoRecord, type DdautoRecord } from "./ddauto-transform";

const record: DdautoRecord = {
  id: "07gUGpPf7QxFEWyREQXE",
  rowId: "a.B7sofKhSOec6qXgZZLgzw",
  year: "2007",
  make: "Audi",
  model: "A4",
  color: "Black",
  vin: "WAUDF78E47A079344",
  status: "Parts",
};

test("DD Auto emits only explicitly active main-yard donors with published YMM", () => {
  const result = transformDdautoRecord(record);
  expect(result).toMatchObject({
    status: "available",
    vehicle: {
      source: "ddauto",
      vin: record.vin,
      year: 2007,
      make: "Audi",
      model: "A4",
      color: "Black",
      locationCode: "logan",
      locationCity: "Logan",
      stateAbbr: "UT",
      lat: 41.7355957,
      lng: -111.8810324,
      detailsUrl: "https://dd-auto-parts-cars.glide.page/dl/17171d",
      stockNumber: null,
      imageUrl: null,
      availableDate: null,
      row: null,
    },
  });
});

test.each(["Premium Lot", "NOT AVAILABLE", "Killed"] as const)(
  "DD Auto excludes native status %s before considering identity",
  (status) => {
    expect(transformDdautoRecord({ ...record, status, vin: "" })).toEqual({
      status: "excluded",
    });
  },
);

test.each(["", "Unknown", "N/A", "burnt"])(
  "DD Auto tolerates unusable optional color %j",
  (color) => {
    expect(transformDdautoRecord({ ...record, color })).toMatchObject({
      status: "available",
      vehicle: { color: null },
    });
  },
);

test.each([
  { vin: "1N4BA1E28C810463" },
  { year: "" },
  { year: "2101" },
  { make: "Unknown" },
  { model: "N/A" },
])("DD Auto rejects incomplete required identities (%#)", (change) => {
  expect(transformDdautoRecord({ ...record, ...change }).status).toBe(
    "incomplete",
  );
});

test("DD Auto preserves independently valid VIN presence when YMM is rejected", () => {
  expect(transformDdautoRecord({ ...record, model: "" })).toEqual({
    status: "incomplete",
    vin: record.vin,
  });
});

test("DD Auto supports published legacy serials without deriving a replacement year", () => {
  expect(
    transformDdautoRecord({ ...record, year: "1965", vin: "5F07C123456" }),
  ).toMatchObject({
    status: "available",
    vehicle: { year: 1965, vin: "5F07C123456" },
  });
  expect(
    transformDdautoRecord({
      ...record,
      year: "2011",
      vin: "5GADT13S472141374",
    }),
  ).toMatchObject({ status: "available", vehicle: { year: 2011 } });
});
