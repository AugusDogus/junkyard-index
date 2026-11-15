import { expect, test } from "bun:test";
import {
  alliedFixture,
  alliedFixtureContract,
  alliedIlx,
  alliedIlxPage,
  alliedValue,
} from "./allied-test-fixtures";
import {
  parseAlliedDirectory,
  parseAlliedArrivals,
  parseAlliedModel,
  parseAlliedOwner,
} from "./allied-parser";
import {
  alliedDonorStock,
  alliedSnapshot,
  validateAlliedSnapshot,
} from "./allied-snapshot";
import { alliedHash } from "./allied-parser";
import { connectorChunkMetrics } from "./connector-chunk";

test("saved Allied controls prove the physical supplier and expose literal native model routes", () => {
  expect(
    parseAlliedOwner(alliedFixture("owner"), alliedFixtureContract.yard).ok,
  ).toBe(true);
  const makes = alliedValue(
    parseAlliedDirectory(alliedFixture("makes"), { kind: "makes" }),
  );
  expect(makes).toHaveLength(45);
  expect(makes.reduce((sum, make) => sum + make.count, 0)).toBe(3181);
  const models = alliedValue(
    parseAlliedDirectory(alliedFixture("models-acura"), {
      kind: "models",
      make: alliedIlx.make,
    }),
  );
  expect(models).toContainEqual(alliedIlx.model);
  const page = alliedIlxPage();
  expect(page.records).toHaveLength(1);
  expect(page.records[0]?.vins).toEqual(["19VDE1F79EE000079"]);
  expect(
    alliedValue(parseAlliedArrivals(alliedFixture("arrivals"))).records,
  ).toHaveLength(39);
});

test("Allied excludes nonstandard stocks independently of VIN presence", () => {
  for (const stock of [
    null,
    "",
    "TRADE",
    "WHEELS",
    "NOF",
    "ARTHUR",
    "SPRING",
    "20IWAP",
    "JWP22G",
    "26M001",
  ])
    expect(alliedDonorStock(stock)).toBe(false);
  for (const stock of ["3G084", "26J169", "14A012"])
    expect(alliedDonorStock(stock)).toBe(true);
  const page = alliedIlxPage();
  const original = page.records[0];
  if (!original) throw new Error("Missing saved Allied donor");
  const records = [
    original,
    { ...original, stock: "WHEELS" },
    { ...original, stock: "26E052", vins: [""] },
  ];
  const snapshot = alliedSnapshot(
    [{ ...page, records, hash: alliedHash(records) }],
    {
      context: { kind: "arrivals" },
      records: [],
      hash: alliedHash([]),
      nativeEmpty: true,
    },
    [{ make: alliedIlx.make, models: [alliedIlx.model] }],
    alliedFixtureContract,
  );
  expect(snapshot.accounting).toEqual({
    recordsProcessed: 3,
    recordsExcluded: 1,
    recordsRejected: 1,
    duplicateVehicles: 0,
  });
  expect(snapshot.vehicles).toHaveLength(1);
  expect(
    connectorChunkMetrics(
      {
        count: snapshot.vehicles.length,
        errors: [],
        accounting: snapshot.accounting,
      },
      snapshot.vehicles.length,
    ),
  ).toEqual({
    vehiclesProcessed: 2,
    uniqueVehicles: 1,
    rejectedVehicles: 1,
    duplicateVehicles: 0,
  });
  expect(validateAlliedSnapshot(snapshot, alliedFixtureContract, null).ok).toBe(
    false,
  );
});

test("Allied rejects truncation, supplier changes and unread continuation", () => {
  for (const raw of [
    alliedFixture("model-ilx").slice(0, -20),
    alliedFixture("model-ilx").replaceAll("KK25", "FOREIGN"),
    alliedFixture("model-ilx").replace(
      '<div class="card-deck">',
      '<a rel="next" href="?page=2">Next</a><div class="card-deck">',
    ),
  ])
    expect(parseAlliedModel(raw, alliedIlx).ok).toBe(false);
});

test("Allied quarantines conflicting VIN/destination groups and retains their presence evidence", () => {
  const page = alliedIlxPage();
  const original = page.records[0];
  if (!original) throw new Error("Missing saved Allied donor");
  const records = [
    original,
    {
      ...original,
      stock: "25A013",
      destinations: original.destinations.map((url) =>
        url.replace("25A012", "25A013"),
      ),
    },
  ];
  const snapshot = alliedSnapshot(
    [{ ...page, records, hash: alliedHash(records) }],
    {
      context: { kind: "arrivals" },
      records: [],
      hash: alliedHash([]),
      nativeEmpty: true,
    },
    [{ make: alliedIlx.make, models: [alliedIlx.model] }],
    alliedFixtureContract,
  );
  expect(snapshot.vehicles).toEqual([]);
  expect(snapshot.accounting.recordsRejected).toBe(2);
  expect(snapshot.observedVins).toEqual(["19VDE1F79EE000079"]);
});

test("Allied does not turn conflicting normal/nonstandard stock claims into an exclusion", () => {
  const raw = alliedFixture("model-ilx").replace(
    /<b>\s*Stock\s*:\s*<\/b>/i,
    "<b>Stock:</b> TRADE<br/><b>Stock:</b>",
  );
  const parsed = parseAlliedModel(raw, alliedIlx);
  expect(parsed.ok).toBe(false);
  if (!parsed.ok)
    expect(parsed.error.message).toContain("conflicting stock codes");
});
