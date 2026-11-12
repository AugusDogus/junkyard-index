import { expect, test } from "bun:test";
import { alln1TestRecord } from "./alln1-test-fixtures";
import { transformAlln1Record } from "./alln1-transform";

test("All-N-1 preserves the native tuple, stock, row, calendar date and bound photo", () => {
  expect(
    transformAlln1Record({
      ...alln1TestRecord,
      model: "FORD F150 PICKUP",
      position: "V V-11",
    }),
  ).toMatchObject({
    status: "available",
    vehicle: {
      source: "alln1",
      make: "Chevrolet",
      model: "FORD F150 PICKUP",
      row: "V V-11",
      stockNumber: "262303",
      availableDate: "2026-10-19",
      imageUrl: alln1TestRecord.imageUrl,
      detailsUrl:
        "https://alln1kc.com/inventory/ANY/ANY/?k=1&view=table&search=2GNALCEK8F6347168",
      locationCode: "MO42",
      stateAbbr: "MO",
      lat: 39.07918,
      lng: -94.471004,
      color: null,
    },
  });
});
test.each(["HOLD", "YARD VAN", "REBUILDER"] as const)(
  "All-N-1 quarantines literal %s without inferring availability meaning",
  (position) => {
    expect(
      transformAlln1Record({ ...alln1TestRecord, position, stock: "2692320" }),
    ).toEqual({ status: "quarantined", position, vin: alln1TestRecord.vin });
  },
);
test.each(["", "Unknown", "N/A"])(
  "All-N-1 admits absent optional metadata (%s)",
  (value) => {
    expect(
      transformAlln1Record({
        ...alln1TestRecord,
        stock: value,
        position: value,
        setDate: value,
        imageUrl: null,
      }),
    ).toMatchObject({
      status: "available",
      vehicle: {
        stockNumber: null,
        row: null,
        availableDate: null,
        imageUrl: null,
      },
    });
  },
);
test("All-N-1 preserves legacy serials and rejected identity presence", () => {
  expect(
    transformAlln1Record({
      ...alln1TestRecord,
      year: "1977",
      vin: "12345678ABC",
    }),
  ).toMatchObject({
    status: "available",
    vehicle: { year: 1977, vin: "12345678ABC" },
  });
  expect(
    transformAlln1Record({ ...alln1TestRecord, model: "Unknown" }),
  ).toEqual({ status: "incomplete", vin: alln1TestRecord.vin });
  expect(transformAlln1Record({ ...alln1TestRecord, vin: "BADVIN" })).toEqual({
    status: "incomplete",
    vin: null,
  });
  expect(
    transformAlln1Record({ ...alln1TestRecord, setDate: "2026-02-30" }),
  ).toMatchObject({ status: "available", vehicle: { availableDate: null } });
});
