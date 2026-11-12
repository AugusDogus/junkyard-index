import { expect, test } from "bun:test";
import { FenixDonor } from "./fenix-donor";
import { fenixTestRecord } from "./fenix-test-fixtures";

test("Fenix accepts native identity and YMM with nullable optional fields", () => {
  const result = FenixDonor.parse({
    ...fenixTestRecord,
    stock: "?",
    row: "UNKNOWN",
    datePlacedInYard: "bad",
    photoUrl: null,
  });
  expect(result.status).toBe("available");
  if (result.status !== "available") return;
  expect(result.donor).toMatchObject({
    vin: fenixTestRecord.vin,
    color: null,
    stockNumber: null,
    position: null,
    availableDate: null,
    photoUrl: null,
  });
});

test("Fenix preserves a genuine donor-bound source thumbnail", () => {
  const result = FenixDonor.parse(fenixTestRecord);
  expect(result.status === "available" ? result.donor.photoUrl : null).toBe(
    fenixTestRecord.photoUrl,
  );
});

test("Fenix preserves valid rejected VIN presence independently of YMM", () => {
  expect(FenixDonor.parse({ ...fenixTestRecord, model: "" })).toEqual({
    status: "incomplete",
    vin: fenixTestRecord.vin,
  });
});

test("Fenix supports genuine older serials without a checksum gate", () => {
  expect(
    FenixDonor.parse({ ...fenixTestRecord, year: "1969", vin: "237379P305552" })
      .status,
  ).toBe("available");
  expect(
    FenixDonor.parse({ ...fenixTestRecord, year: "2004", vin: "237379P305552" })
      .status,
  ).toBe("incomplete");
});

test("Fenix rejects explicit inactive placement while retaining valid VIN", () => {
  expect(FenixDonor.parse({ ...fenixTestRecord, row: "CRUSHED" })).toEqual({
    status: "incomplete",
    vin: fenixTestRecord.vin,
  });
});
