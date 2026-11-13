import { expect, test } from "bun:test";
import { parsePrattArrivals, parsePrattModel } from "./pratt-parser";
import { PrattRecord } from "./pratt-record";
import { prattSnapshot, validatePrattSnapshot } from "./pratt-snapshot";
import {
  prattFixture,
  prattFixtureContract,
  prattFixtureLexus,
  prattValue,
} from "./pratt-test-fixtures";

const lexus = () =>
  prattValue(
    parsePrattModel(prattFixture("model-lexus.html"), prattFixtureLexus),
  );
const arrivals = () =>
  prattValue(parsePrattArrivals(prattFixture("arrivals.html")));
const menus = [
  { make: prattFixtureLexus.make, models: [prattFixtureLexus.model] },
];
test("Pratt whole native union accounts for overlaps and optional disagreements", () => {
  const snapshot = prattSnapshot(
    [lexus()],
    arrivals(),
    menus,
    prattFixtureContract,
  );
  expect(snapshot.accounting).toEqual({
    recordsProcessed: 62,
    recordsRejected: 0,
    recordsExcluded: 0,
    duplicateVehicles: 1,
  });
  expect(snapshot.vehicles).toHaveLength(61);
  expect(snapshot.conflicts).toEqual([]);
  expect(
    snapshot.vehicles.find((vehicle) => vehicle.stockNumber === "J60711")
      ?.availableDate,
  ).toBe("2026-10-23");
  expect(validatePrattSnapshot(snapshot, prattFixtureContract, null).ok).toBe(
    true,
  );
});
test("Pratt quarantines archived NISSAN/DATSUN and fresh NISSAN before canonical normalization", () => {
  const page = prattValue(
    parsePrattModel(prattFixture("model-nissan.html"), {
      make: { path: "/parts/NISSAN", label: "NISSAN", count: 10 },
      model: { path: "/parts/NISSAN/NV200/", label: "NV200", count: 3 },
    }),
  );
  const snapshot = prattSnapshot(
    [page],
    arrivals(),
    menus,
    prattFixtureContract,
  );
  expect(
    snapshot.vehicles.some((vehicle) => vehicle.vin === "3N6CM0KN5EK699701"),
  ).toBe(false);
  expect(snapshot.observedVins).toContain("3N6CM0KN5EK699701");
  expect(snapshot.accounting.recordsRejected).toBe(3);
  expect(
    snapshot.conflicts.some(
      (group) => group.domain === "vin" && group.value === "3N6CM0KN5EK699701",
    ),
  ).toBe(true);
});
test("Pratt preserves secondary VIN presence and quarantines every connected donor variant", () => {
  const page = lexus();
  const first = page.records[0],
    second = page.records[1];
  if (!first || !second) throw new Error("Saved Lexus rows missing");
  const altered = { ...first, inquiries: ["LEXUS - VIN JTHBL46F575039780"] };
  const assessment = PrattRecord.assess(altered, page.context);
  expect(assessment.validVinClaims).toEqual([
    "JTHBL46F575039780",
    "JTHBL5EF7C5113721",
  ]);
  const snapshot = prattSnapshot(
    [{ ...page, records: [altered, second] }],
    { context: { kind: "arrivals" }, records: [], hash: "", nativeEmpty: true },
    menus,
    prattFixtureContract,
  );
  expect(snapshot.vehicles).toEqual([]);
  expect(snapshot.accounting.recordsRejected).toBe(2);
  expect(snapshot.observedVins).toEqual([
    "JTHBL46F575039780",
    "JTHBL5EF7C5113721",
  ]);
});
test("Pratt quarantines distinct donor destinations and destination-to-VIN collisions without a winner", () => {
  const page = lexus();
  const first = page.records[0];
  if (!first) throw new Error("Saved Lexus row missing");
  const variants = [
    {
      ...first,
      stock: null,
      destinations: first.destinations.map((url) =>
        url.replace("J60711", "OTHER"),
      ),
    },
    {
      ...first,
      vins: ["JTHBL46F575039780"],
      inquiries: first.inquiries.map((claim) =>
        claim.replace("JTHBL5EF7C5113721", "JTHBL46F575039780"),
      ),
    },
  ];
  for (const variant of variants) {
    const snapshot = prattSnapshot(
      [{ ...page, records: [first, variant] }],
      {
        context: { kind: "arrivals" },
        records: [],
        hash: "",
        nativeEmpty: true,
      },
      menus,
      prattFixtureContract,
    );
    expect(snapshot.vehicles).toEqual([]);
    expect(snapshot.accounting.recordsRejected).toBe(2);
    expect(snapshot.observedVins).toContain("JTHBL5EF7C5113721");
    expect(snapshot.conflicts.length).toBeGreaterThan(0);
  }
});
test("Pratt optional stock, photo, color, date, mileage and position never gate identity", () => {
  const page = lexus();
  const first = page.records[0];
  if (!first) throw new Error("Saved Lexus row missing");
  const record = {
    ...first,
    stock: null,
    image: "https://foreign.example/photo.jpg",
    date: "bad",
  };
  const snapshot = prattSnapshot(
    [{ ...page, records: [record] }],
    { context: { kind: "arrivals" }, records: [], hash: "", nativeEmpty: true },
    menus,
    prattFixtureContract,
  );
  expect(snapshot.accounting.recordsRejected).toBe(0);
  expect(snapshot.vehicles[0]).toMatchObject({
    stockNumber: null,
    imageUrl: null,
    availableDate: null,
    section: null,
    row: null,
    space: null,
  });
});
test("Pratt incomplete observations preserve VIN presence without inventing a conflict against complete observations", () => {
  const page = lexus();
  const first = page.records[0];
  if (!first) throw new Error("Saved Lexus row missing");
  for (const partial of [
    { ...first, titles: [] },
    { ...first, years: [] },
    { ...first, destinations: [] },
  ]) {
    const snapshot = prattSnapshot(
      [{ ...page, records: [first, partial] }],
      {
        context: { kind: "arrivals" },
        records: [],
        hash: "",
        nativeEmpty: true,
      },
      menus,
      prattFixtureContract,
    );
    expect(snapshot.vehicles).toHaveLength(1);
    expect(snapshot.accounting.recordsRejected).toBe(1);
    expect(snapshot.conflicts).toEqual([]);
    expect(snapshot.observedVins).toEqual(["JTHBL5EF7C5113721"]);
  }
  const missingArrivalRoute = prattSnapshot(
    [{ ...page, records: [first] }],
    {
      context: { kind: "arrivals" },
      records: [{ ...first, destinations: [] }],
      hash: "",
      nativeEmpty: false,
    },
    menus,
    prattFixtureContract,
  );
  expect(missingArrivalRoute.vehicles).toHaveLength(1);
  expect(missingArrivalRoute.accounting.recordsRejected).toBe(1);
  expect(missingArrivalRoute.conflicts).toEqual([]);
  expect(missingArrivalRoute.observedVins).toEqual(["JTHBL5EF7C5113721"]);
});
test("Pratt keeps source minimum, 10% rejection, 25% duplicates and 50% drift guards", () => {
  const snapshot = prattSnapshot(
    [lexus()],
    arrivals(),
    menus,
    prattFixtureContract,
  );
  expect(
    validatePrattSnapshot(
      snapshot,
      { ...prattFixtureContract, minimumUniqueInventory: 62 },
      null,
    ).ok,
  ).toBe(false);
  expect(validatePrattSnapshot(snapshot, prattFixtureContract, 123).ok).toBe(
    false,
  );
  expect(validatePrattSnapshot(snapshot, prattFixtureContract, 122).ok).toBe(
    true,
  );
  const rejection = {
    ...snapshot,
    accounting: {
      ...snapshot.accounting,
      recordsProcessed: 69,
      recordsRejected: 8,
      duplicateVehicles: 0,
    },
  };
  const rejected = validatePrattSnapshot(rejection, prattFixtureContract, null);
  expect(rejected.ok).toBe(false);
  if (!rejected.ok)
    expect(rejected.error.message).toContain("rejection exceeds 10%");
  const exactRejection = {
    ...snapshot,
    vehicles: snapshot.vehicles.slice(0, 9),
    accounting: {
      ...snapshot.accounting,
      recordsProcessed: 10,
      recordsRejected: 1,
      duplicateVehicles: 0,
    },
  };
  expect(
    validatePrattSnapshot(exactRejection, prattFixtureContract, null).ok,
  ).toBe(true);
  const exactDuplicates = {
    ...snapshot,
    vehicles: snapshot.vehicles.slice(0, 3),
    accounting: {
      ...snapshot.accounting,
      recordsProcessed: 4,
      recordsRejected: 0,
      duplicateVehicles: 1,
    },
  };
  expect(
    validatePrattSnapshot(exactDuplicates, prattFixtureContract, null).ok,
  ).toBe(true);
  const duplicate = {
    ...exactDuplicates,
    accounting: {
      ...snapshot.accounting,
      recordsProcessed: 5,
      recordsRejected: 0,
      duplicateVehicles: 2,
    },
  };
  const duplicated = validatePrattSnapshot(
    duplicate,
    prattFixtureContract,
    null,
  );
  expect(duplicated.ok).toBe(false);
  if (!duplicated.ok)
    expect(duplicated.error.message).toContain("duplicates exceed 25%");
});
