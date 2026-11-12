import { expect, test } from "bun:test";
import { transformAviationRecord } from "./aviation-transform";
import { aviationFixtureRecord } from "./aviation-test-fixtures";

test("Aviation uses existing VIN rules and preserves optional metadata without requiring it", () => {
  const record = aviationFixtureRecord(1);
  record[5] = "ST1/ST1_0.jpg";
  record[6] = "2026-10-22";
  const result = transformAviationRecord(record, {
    make: "ACURA",
    model: "ILX",
  });
  expect(result.status).toBe("available");
  if (result.status !== "available")
    throw new Error("Expected valid native vehicle");
  expect(result.vehicle).toMatchObject({
    vin: record[0],
    make: "Acura",
    model: "ILX",
    year: 2003,
    availableDate: "2026-10-22",
    color: null,
    imageUrl: "https://da8h1v3w8q6n5.cloudfront.net/az30/images/ST1/ST1_0.jpg",
    stateAbbr: "AZ",
    lat: 32.14894,
    lng: -110.88075,
  });
  record[5] = "https://example.com/ST1.jpg";
  record[6] = "2026-02-31";
  const optional = transformAviationRecord(record, {
    make: "ACURA",
    model: "ILX",
  });
  expect(
    optional.status === "available" &&
      optional.vehicle.imageUrl === null &&
      optional.vehicle.availableDate === null,
  ).toBe(true);
  record[0] = "ABC123";
  record[1] = "1979";
  record[4] = "/used-parts/ACURA/ILX/ST1/1979";
  expect(
    transformAviationRecord(record, { make: "ACURA", model: "ILX" }).status,
  ).toBe("available");
  record[1] = "1981";
  expect(
    transformAviationRecord(record, { make: "ACURA", model: "ILX" }).status,
  ).toBe("incomplete");
});

test("Aviation resolves SMART only with explicit model context and verifies stock/year destination binding", () => {
  const record = aviationFixtureRecord(1);
  record[2] = "SMART";
  record[4] = "/used-parts/SMART/SMART/ST1/2003";
  expect(
    transformAviationRecord(record, { make: "SMART", model: "SMART" }).status,
  ).toBe("available");
  expect(
    transformAviationRecord(record, { make: "SMART", model: "" }).status,
  ).toBe("incomplete");
  record[4] = "/used-parts/SMART/SMART/OTHER/2003";
  expect(
    transformAviationRecord(record, { make: "SMART", model: "SMART" }).status,
  ).toBe("incomplete");
});
