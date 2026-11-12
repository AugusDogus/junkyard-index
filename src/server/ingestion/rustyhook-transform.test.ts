import { expect, test } from "bun:test";
import { parseRustyhookDetail } from "./rustyhook-parser";
import {
  rustyhookRecordVins,
  transformRustyhookRecord,
} from "./rustyhook-transform";
import {
  rustyhookTestDetail,
  rustyhookTestPosts,
} from "./rustyhook-test-fixtures";

function record(index = 0, fields: Record<string, string> = {}) {
  const post = rustyhookTestPosts[index];
  if (!post) throw new Error("Missing donor fixture");
  return parseRustyhookDetail(rustyhookTestDetail(index, fields), post);
}
test("Rusty Hook retains the native padded identifier and nulls optional placeholders without inventing dates", () => {
  const result = transformRustyhookRecord(
    record(25, { Engine: "NA", "Car Notes": "Has keys 10/27/26" }),
  );
  expect(result).toMatchObject({
    status: "available",
    vehicle: {
      vin: "XXXX00000E1031782",
      year: 1958,
      make: "Buick",
      model: "SPECIAL",
      color: null,
      engine: null,
      availableDate: null,
      row: null,
      lat: 40.47834,
      lng: -79.98681,
    },
  });
  expect(transformRustyhookRecord(record())).toMatchObject({
    status: "available",
    vehicle: { stockNumber: "0000" },
  });
});
test("Rusty Hook counts a native VIN conflict and preserves both exact source identities", () => {
  const raw = record(0, {
    VIN: "2GNFLGE35F622462x",
    "Car Notes": "2GNFLGE35F6224627 Actual Vin",
  });
  expect(raw.fields.VIN).toBe("2GNFLGE35F622462x");
  expect(rustyhookRecordVins(raw)).toEqual([
    "2GNFLGE35F622462X",
    "2GNFLGE35F6224627",
  ]);
  expect(transformRustyhookRecord(raw)).toEqual({
    status: "rejected",
    reason: "conflicting_native_vin",
    observedVins: ["2GNFLGE35F622462X", "2GNFLGE35F6224627"],
  });
});
test.each<Record<string, string>>([
  { VIN: "unknown" },
  { Year: "" },
  { Make: "NA" },
  { Model: "Unknown" },
  { Year: "2012" },
])(
  "Rusty Hook rejects required loss/conflict without optional field requirements (%#)",
  (fields) => {
    expect(transformRustyhookRecord(record(0, fields)).status).toBe("rejected");
  },
);
test("Rusty Hook distinguishes explicit whole-donor removal from component sales and prior parting", () => {
  expect(transformRustyhookRecord(record()).status).toBe("available");
  expect(
    transformRustyhookRecord(
      record(0, { "Car Notes": "The whole vehicle is sold." }),
    ),
  ).toMatchObject({ status: "rejected", reason: "inactive_donor" });
});
