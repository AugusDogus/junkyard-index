import { expect, test } from "bun:test";
import { parseRohnerArticle } from "./rohner-parser";
import type { RohnerArticleResult } from "./rohner-record";
import { rohnerFixture, rohnerNativeFixtures } from "./rohner-test-fixtures";
import {
  rohnerInventorySnapshot,
  transformRohnerCandidate,
  validateRohnerInventorySnapshot,
} from "./rohner-transform";
import { ROHNER_YARD } from "./rohner-yard-metadata";

const records = () =>
  ["aa0301", "aa0304", "aa0303", "aa0268", "aa0279", "aa0185", "aa0126"]
    .map(rohnerFixture)
    .map((fixture) =>
      parseRohnerArticle(fixture.html, fixture.url, fixture.cards),
    );

test("Rohner canonical vehicles preserve every native optional value and exact yard identity", () => {
  for (const fixture of rohnerNativeFixtures().articles) {
    const record = parseRohnerArticle(fixture.html, fixture.url, fixture.cards);
    expect(record.status).toBe("required-pass");
    if (record.status !== "required-pass")
      throw new Error("Native fixture rejected");
    if (!fixture.expected.candidate)
      throw new Error("Native fixture candidate missing");
    const vehicle = transformRohnerCandidate(record.candidate);
    expect(vehicle).toEqual({
      ...fixture.expected.candidate,
      source: "rohner",
      locationCode: "willmar",
      locationName: "Rohner's Auto Parts, Inc.",
      locationCity: "Willmar",
      state: "Minnesota",
      stateAbbr: "MN",
      lat: 45.2116768,
      lng: -95.06669989999999,
    });
    expect(vehicle.availableDate).toBeNull();
  }
  expect(ROHNER_YARD).toMatchObject({
    address: "1800 County Road 27 NW",
    phone: "320-235-4602",
    email: "info@rohnersautoparts.com",
  });
});

test("Rohner excludes only the explicit sold rebuilder and preserves Scrap and Part Out donors", () => {
  const snapshot = rohnerInventorySnapshot(records());
  expect(snapshot.accounting).toEqual({
    recordsProcessed: 7,
    recordsExcluded: 1,
    recordsRejected: 0,
    duplicateVehicles: 0,
  });
  expect(snapshot.vehicles).toHaveLength(6);
  expect(snapshot.observedVins).not.toContain("RA29076797");
  expect(
    snapshot.vehicles.some((vehicle) => vehicle.stockNumber === "AA0279"),
  ).toBe(true);
  expect(
    snapshot.vehicles.some((vehicle) => vehicle.stockNumber === "AA0303"),
  ).toBe(true);
  expect(() => validateRohnerInventorySnapshot(snapshot)).not.toThrow();
});

test("Rohner conflicting claims quarantine the entire identity group and retain presence", () => {
  const fixture = rohnerFixture("aa0304");
  const valid = parseRohnerArticle(fixture.html, fixture.url, fixture.cards);
  const conflicting: RohnerArticleResult = {
    ...valid,
    status: "identity-conflict",
    candidate: null,
    reasons: ["Conflicting native Make claim"],
    nativeRequiredFields: [
      ...valid.nativeRequiredFields,
      {
        boundary: "conflicting-native-label",
        label: "Make",
        value: "Ford",
        raw: "Make: Ford",
      },
    ],
  };
  const snapshot = rohnerInventorySnapshot([valid, conflicting]);
  expect(snapshot.vehicles).toEqual([]);
  expect(snapshot.observedVins).toEqual(["ML32A4HJ3FH039866"]);
  expect(snapshot.accounting.recordsRejected).toBe(2);
  expect(() => validateRohnerInventorySnapshot(snapshot)).toThrow(
    "10% rejection",
  );
});

test("Rohner unchanged rejection and duplicate limits ignore intentional sold exclusions", () => {
  const snapshot = rohnerInventorySnapshot(records());
  const counts = {
    ...snapshot.accounting,
    recordsProcessed: 11,
    recordsExcluded: 1,
  };
  expect(() =>
    validateRohnerInventorySnapshot({
      ...snapshot,
      accounting: { ...counts, recordsRejected: 1 },
    }),
  ).not.toThrow();
  expect(() =>
    validateRohnerInventorySnapshot({
      ...snapshot,
      accounting: { ...counts, recordsRejected: 2 },
    }),
  ).toThrow("10% rejection");
  expect(() =>
    validateRohnerInventorySnapshot({
      ...snapshot,
      accounting: { ...counts, duplicateVehicles: 3 },
    }),
  ).toThrow("25% duplicate");
});
