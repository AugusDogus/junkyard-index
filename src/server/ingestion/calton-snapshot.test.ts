import { expect, test } from "bun:test";
import type { CaltonLocation } from "./calton-contract";
import type { CaltonPage } from "./calton-parser";
import type { CaltonRecord } from "./calton-record";
import { CaltonSnapshot } from "./calton-snapshot";

const location: CaltonLocation = {
  code: "elkridge",
  name: "Calton Auto Parts Recyclers",
  city: "Elkridge",
  lat: 39.1794853,
  lng: -76.7697906,
};

function record(
  options: { model?: string; year?: string; vin?: string; stock?: string } = {},
): CaltonRecord {
  const model = options.model ?? "A5";
  const year = options.year ?? "2015";
  const stock = options.stock ?? "G02010";
  const path = `/parts/AUDI/AUDI_${model}`;
  const sourceUrl = `https://caltonautoparts.com${path}`;
  const destination = `${sourceUrl}/${stock}/${year}`;
  return {
    sourceUrl,
    context: {
      kind: "model",
      sourceUrl,
      make: {
        path: "/parts/AUDI",
        literal: "https://caltonautoparts.com/parts/AUDI",
        label: "AUDI",
        count: 151,
      },
      model: { path, literal: sourceUrl, label: model, count: 1 },
    },
    ordinal: 0,
    cardId: stock,
    years: [year],
    titles: [`AUDI ${model}`],
    vins: [options.vin ?? "WAUCGAFR7EA042538"],
    fields: [{ label: "stock", value: stock }],
    destinations: [{ literal: destination, url: destination }],
    images: [],
  };
}

function page(records: CaltonRecord[]): CaltonPage {
  const first = records[0];
  if (!first) throw new Error("Test page requires an explicit native context");
  return {
    sourceUrl: first.sourceUrl,
    context: first.context,
    bytes: 100,
    bodyHash: "a".repeat(64),
    records,
    continuationControls: [],
    nativeEmptyResult: null,
    countCheck: {
      kind: "matches",
      advertised: records.length,
      observed: records.length,
    },
  };
}

test("quarantines every appearance of a VIN with conflicting native model/year claims", () => {
  // Saved Calton G02010 appears under both these native identities.
  const snapshot = CaltonSnapshot.create(
    [page([record()]), page([record({ model: "S5", year: "2014" })])],
    ["AUDI"],
    location,
  );
  expect(snapshot.vehicles).toEqual([]);
  expect(snapshot.observedVins).toEqual(["WAUCGAFR7EA042538"]);
  expect(snapshot.accounting).toEqual({
    recordsProcessed: 2,
    recordsRejected: 2,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  });
  expect(snapshot.quarantinedRecordIndices).toEqual([0, 1]);
});

test("keeps valid rejected VIN presence when a native year is absent", () => {
  const incomplete = { ...record(), years: [] };
  const snapshot = CaltonSnapshot.create(
    [page([incomplete])],
    ["AUDI"],
    location,
  );
  expect(snapshot.vehicles).toEqual([]);
  expect(snapshot.observedVins).toEqual(["WAUCGAFR7EA042538"]);
  expect(snapshot.accounting.recordsRejected).toBe(1);
});

test("quarantines transitive VIN and destination conflicts without a first-row winner", () => {
  const first = record();
  const second = record({ vin: "WAUCGAFR7EA042539" });
  const third = record({ vin: "WAUCGAFR7EA042539", stock: "SECOND" });
  const bridge = { ...third, vins: ["WAUCGAFR7EA042539", "WAUCGAFR7EA042540"] };
  const fourth = record({ vin: "WAUCGAFR7EA042540", stock: "FOURTH" });
  const snapshot = CaltonSnapshot.create(
    [page([first, second, bridge, fourth])],
    ["AUDI"],
    location,
  );
  expect(snapshot.vehicles).toEqual([]);
  expect(snapshot.quarantinedRecordIndices).toEqual([0, 1, 2, 3]);
  expect(snapshot.observedVins).toEqual([
    "WAUCGAFR7EA042538",
    "WAUCGAFR7EA042539",
    "WAUCGAFR7EA042540",
  ]);
  expect(snapshot.accounting.recordsRejected).toBe(4);
});

test("incomplete observations do not invent conflicts against complete native identities", () => {
  const complete = record();
  for (const partial of [
    { ...complete, years: [] },
    { ...complete, titles: [] },
    { ...complete, destinations: [] },
  ]) {
    const snapshot = CaltonSnapshot.create(
      [page([complete, partial])],
      ["AUDI"],
      location,
    );
    expect(snapshot.vehicles).toHaveLength(1);
    expect(snapshot.accounting.recordsRejected).toBe(1);
    expect(snapshot.conflicts).toEqual([]);
    expect(snapshot.observedVins).toEqual(["WAUCGAFR7EA042538"]);
  }
});

test("benign duplicate appearances retain identity and null disagreeing optional metadata", () => {
  const first = {
    ...record(),
    fields: [{ label: "enter date", value: "2026-11-01" }],
  };
  const second = {
    ...record(),
    fields: [{ label: "enter date", value: "2026-11-02" }],
  };
  const snapshot = CaltonSnapshot.create(
    [page([first, second])],
    ["AUDI"],
    location,
  );
  expect(snapshot.vehicles).toHaveLength(1);
  expect(snapshot.vehicles[0]).toMatchObject({
    vin: "WAUCGAFR7EA042538",
    availableDate: null,
    stockNumber: null,
    imageUrl: null,
  });
  expect(snapshot.accounting).toEqual({
    recordsProcessed: 2,
    recordsRejected: 0,
    recordsExcluded: 0,
    duplicateVehicles: 1,
  });
  expect(snapshot.quarantinedRecordIndices).toEqual([]);
});

test("a stock number alone never merges distinct native donors", () => {
  const snapshot = CaltonSnapshot.create(
    [
      page([
        record(),
        record({ vin: "WAUCGAFR7EA042539", model: "S5", year: "2014" }),
      ]),
    ],
    ["AUDI"],
    location,
  );
  expect(snapshot.vehicles).toHaveLength(2);
  expect(snapshot.conflicts).toEqual([]);
  expect(snapshot.accounting.duplicateVehicles).toBe(0);
});

test("one usable optional observation fills an absent duplicate value", () => {
  const first = record();
  const second = {
    ...record(),
    fields: [...first.fields, { label: "enter date", value: "2026-11-01" }],
  };
  const snapshot = CaltonSnapshot.create(
    [page([first, second])],
    ["AUDI"],
    location,
  );
  expect(snapshot.vehicles[0]?.availableDate).toBe("2026-11-01");
});

test("keeps pre-1981 literal serials under the existing inventory VIN contract", () => {
  const snapshot = CaltonSnapshot.create(
    [page([record({ year: "1970", vin: "0F02F100001" })])],
    ["AUDI"],
    location,
  );
  expect(snapshot.vehicles[0]?.vin).toBe("0F02F100001");
});

test("validates source minimum and exact rejection, duplicate and previous-run boundaries", () => {
  const rows = Array.from({ length: 9 }, (_, index) =>
    record({
      stock: `TEST${index}`,
      vin: `WAUCGAFR7EA${String(index).padStart(6, "0")}`,
    }),
  );
  const minimum = { minimumUniqueInventory: 1, previousUniqueInventory: null };
  const snapshot = (records: CaltonRecord[]) =>
    CaltonSnapshot.create([page(records)], ["AUDI"], location);
  const exactRejection = snapshot([
    ...rows,
    record({ vin: "-", stock: "INVALID" }),
  ]);
  expect(CaltonSnapshot.validate(exactRejection, minimum).ok).toBe(true);
  const rejected = CaltonSnapshot.validate(
    snapshot([
      ...rows.slice(0, 8),
      record({ vin: "-", stock: "BAD1" }),
      record({ vin: "-", stock: "BAD2" }),
    ]),
    minimum,
  );
  expect(rejected.ok).toBe(false);
  if (!rejected.ok) {
    expect(rejected.error.tag).toBe("CaltonSnapshotError");
    expect(rejected.error.message).toContain("rejection exceeds 10%");
    expect(rejected.error.message).toContain("prior inventory is preserved");
  }
  const first = rows[0];
  if (!first) throw new Error("Missing native guard fixture");
  const exactDuplicates = snapshot([...rows.slice(0, 3), first]);
  expect(CaltonSnapshot.validate(exactDuplicates, minimum).ok).toBe(true);
  const duplicated = CaltonSnapshot.validate(
    snapshot([...rows.slice(0, 3), first, first]),
    minimum,
  );
  expect(duplicated.ok).toBe(false);
  if (!duplicated.ok)
    expect(duplicated.error.message).toContain("duplicates exceed 25%");
  expect(
    CaltonSnapshot.validate(exactDuplicates, {
      ...minimum,
      previousUniqueInventory: 6,
    }).ok,
  ).toBe(true);
  expect(
    CaltonSnapshot.validate(exactDuplicates, {
      ...minimum,
      previousUniqueInventory: 7,
    }).ok,
  ).toBe(false);
  expect(
    CaltonSnapshot.validate(exactDuplicates, {
      ...minimum,
      minimumUniqueInventory: 4,
    }).ok,
  ).toBe(false);
  expect(
    CaltonSnapshot.validate(exactDuplicates, {
      ...minimum,
      minimumUniqueInventory: 0,
    }).ok,
  ).toBe(false);
  expect(
    CaltonSnapshot.validate(
      {
        ...exactDuplicates,
        accounting: { ...exactDuplicates.accounting, recordsProcessed: 5 },
      },
      minimum,
    ).ok,
  ).toBe(false);
});
