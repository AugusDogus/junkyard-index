import { expect, test } from "bun:test";
import { transformAeroRecord } from "./aero-transform";
import { aeroTestRecord } from "./aero-test-fixtures";

test("Aero preserves valid native metadata and a published stock-matched photo", () => {
  expect(transformAeroRecord(aeroTestRecord)).toMatchObject({
    status: "available",
    vehicle: {
      source: "aero",
      vin: aeroTestRecord.vin,
      year: 2004,
      make: "Nissan",
      model: "TITAN",
      color: "Gray",
      stockNumber: "STK004808",
      row: "19",
      availableDate: "2026-10-28T00:00:00.000Z",
      imageUrl: "https://aeroautosalvage.com/inventoryphotos/STK004808-A.jpeg",
      stateAbbr: "LA",
      locationCode: "shreveport",
    },
  });
});

test.each([
  [{ color: "Unknown" }, { color: null }],
  [{ color: "" }, { color: null }],
  [{ row: "0" }, { row: null }],
  [{ row: "" }, { row: null }],
  [{ stock: "4808" }, { stockNumber: null }],
  [{ stock: "" }, { stockNumber: null }],
  [{ arrived: "02/30/26" }, { availableDate: null }],
  [{ arrived: "10/28/2" }, { availableDate: null }],
  [{ arrived: "" }, { availableDate: null }],
  [{ images: [] }, { imageUrl: null }],
  [{ images: ["/inventoryphotos/default.png"] }, { imageUrl: null }],
  [{ images: ["/inventoryphotos/STK004809-A.jpeg"] }, { imageUrl: null }],
  [
    { images: ["https://other.example/inventoryphotos/STK004808-A.jpeg"] },
    { imageUrl: null },
  ],
  [
    {
      images: [
        "https://user@aeroautosalvage.com/inventoryphotos/STK004808-A.jpeg",
      ],
    },
    { imageUrl: null },
  ],
  [
    { images: ["/inventoryphotos/STK004808-A.jpeg?expires=123"] },
    { imageUrl: null },
  ],
  [{ images: ["/inventoryphotos/STK004808-A.jpeg#photo"] }, { imageUrl: null }],
])(
  "Aero retains donors with missing or invalid optional metadata (%#)",
  (patch, metadata) => {
    expect(transformAeroRecord({ ...aeroTestRecord, ...patch })).toMatchObject({
      status: "available",
      vehicle: { vin: aeroTestRecord.vin, ...metadata },
    });
  },
);

test("Aero preserves a published native photo independently of absent stock", () => {
  expect(transformAeroRecord({ ...aeroTestRecord, stock: "" })).toMatchObject({
    status: "available",
    vehicle: {
      stockNumber: null,
      imageUrl: "https://aeroautosalvage.com/inventoryphotos/STK004808-A.jpeg",
    },
  });
});

test("Aero emits null for every absent optional field without inventing metadata", () => {
  expect(
    transformAeroRecord({
      ...aeroTestRecord,
      color: "",
      stock: "",
      row: "",
      arrived: "",
      images: [],
    }),
  ).toMatchObject({
    status: "available",
    vehicle: {
      vin: aeroTestRecord.vin,
      color: null,
      stockNumber: null,
      row: null,
      availableDate: null,
      imageUrl: null,
    },
  });
});

test.each([
  { year: "" },
  { year: "2004junk" },
  { year: "1885" },
  { year: "2101" },
  { make: "Unknown" },
  { make: "" },
  { model: "" },
  { model: "Unknown" },
])("Aero still requires usable year, make and model (%#)", (patch) => {
  expect(transformAeroRecord({ ...aeroTestRecord, ...patch })).toEqual({
    status: "incomplete",
    vin: aeroTestRecord.vin,
  });
});

test("Aero accepts genuine older serials but never repairs modern VINs", () => {
  expect(
    transformAeroRecord({ ...aeroTestRecord, year: "1974", vin: "4K91T190075" })
      .status,
  ).toBe("available");
  expect(
    transformAeroRecord({ ...aeroTestRecord, vin: "1N6AA06A04N53915" }),
  ).toEqual({ status: "incomplete", vin: null });
});

test("Aero quarantines the documented BMW BELAIR without guessing its model", () => {
  expect(
    transformAeroRecord({
      ...aeroTestRecord,
      stock: "STK007105",
      vin: "5UXFE43588L007670",
      year: "2008",
      make: "BMW",
      model: "BELAIR",
      images: ["/inventoryphotos/STK007105.jpeg"],
    }),
  ).toEqual({ status: "incomplete", vin: "5UXFE43588L007670" });
});
