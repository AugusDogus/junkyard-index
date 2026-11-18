import { expect, test } from "bun:test";
import { parseBeaversCatalog, parseBeaversDetail } from "./beavers-parser";
import { beaversFixture, beaversTestRecord } from "./beavers-test-fixtures";
import { beaversSnapshot, beaversYear } from "./beavers-transform";
import { BEAVERS_CATALOG, BEAVERS_YARD } from "./beavers-yard-metadata";

test("real native donor keeps YMM, stock and destination with absent optional fields null", () => {
  const row = parseBeaversCatalog(beaversFixture("first"), BEAVERS_CATALOG)
    .rows[0];
  if (!row) throw new Error("Missing native donor fixture");
  const snapshot = beaversSnapshot(
    [parseBeaversDetail(beaversFixture("donor"), row)],
    null,
    1,
  );
  expect(snapshot.errors).toEqual([]);
  expect(snapshot.vehicles[0]).toMatchObject({
    vin: "5J8YD3H36JL001078",
    year: 2018,
    make: "Acura",
    model: "MDX",
    stockNumber: "260540",
    detailsUrl:
      "https://beaversgarage.hollanderstores.com/VehiclePartSearch/503/72805148",
    stateAbbr: "NC",
    lat: BEAVERS_YARD.lat,
    lng: BEAVERS_YARD.lng,
    color: null,
    imageUrl: "https://d1vnbry5hm94g5.cloudfront.net/MB/6E/XU/UU/6.jpg",
    availableDate: null,
    section: null,
    row: null,
    space: null,
  });
});
test("actual missing native make rejects and retains valid VIN without manufacturer inference", () => {
  const row = parseBeaversCatalog(
    beaversFixture("second"),
    `${BEAVERS_CATALOG}?page=2`,
  ).rows.find((row) => row.stock === "260512");
  if (!row) throw new Error("Missing native absent-make fixture");
  const snapshot = beaversSnapshot(
    [parseBeaversDetail(beaversFixture("missing-make"), row)],
    null,
    1,
  );
  expect(snapshot.vehicles).toHaveLength(0);
  expect(snapshot.accounting.recordsRejected).toBe(1);
  expect(snapshot.observedVins).toEqual(["3FMCR9C60MRA96009"]);
});
test("short years use only the explicit 1985 onward window and reject invalid or future values", () => {
  expect(beaversYear("'85", 2026)).toBe(1985);
  expect(beaversYear("'00", 2026)).toBe(2000);
  expect(beaversYear("'27", 2026)).toBe(2027);
  expect(beaversYear("'28", 2026)).toBeNull();
  expect(beaversYear("'84", 2026)).toBeNull();
  expect(beaversYear("2018", 2026)).toBeNull();
});
test("every appearance of conflicting identities is quarantined and both joined VINs survive rejection", () => {
  const first = beaversTestRecord(0),
    second = beaversTestRecord(1);
  const conflict = {
    ...second,
    vin: first.vin,
    row: { ...second.row, vin: first.vin },
  };
  const snapshot = beaversSnapshot([first, conflict], null, 1);
  expect(snapshot.vehicles).toHaveLength(0);
  expect(snapshot.accounting.recordsRejected).toBe(2);
  expect(snapshot.conflicts).toEqual([first.vin]);
  const mismatched = beaversSnapshot([{ ...first, vin: second.vin }], null, 1);
  expect(mismatched.observedVins).toEqual([first.vin, second.vin]);
});
test("existing rejection, duplicate, minimum and previous-run drift limits fail closed", () => {
  const records = Array.from({ length: 10 }, (_, index) =>
    beaversTestRecord(index),
  );
  const good = records[0];
  if (!good) throw new Error("Missing test donor");
  expect(beaversSnapshot(records, 20, 1).errors).toEqual([]);
  expect(beaversSnapshot(records, 22, 1).errors.join()).toContain("50%");
  expect(beaversSnapshot(records, null, 11).errors.join()).toContain("minimum");
  const rejects = records.map((record, index) =>
    index < 2 ? { ...record, make: null } : record,
  );
  expect(beaversSnapshot(rejects, null, 1).errors.join()).toContain("10%");
  expect(beaversSnapshot([good, good, good], null, 1).errors.join()).toContain(
    "25%",
  );
  expect(
    beaversSnapshot([{ ...good, inactive: true }], null, 1).accounting,
  ).toMatchObject({ recordsExcluded: 1, recordsRejected: 0 });
});
test("optional placeholder and absent stocks become null while contradictory real stocks reject", () => {
  const good = beaversTestRecord(0);
  for (const stock of ["", "unknown", "N/A", "000"])
    expect(
      beaversSnapshot(
        [{ ...good, stock, row: { ...good.row, stock } }],
        null,
        1,
      ).vehicles[0]?.stockNumber,
    ).toBeNull();
  expect(
    beaversSnapshot([{ ...good, stock: "unknown" }], null, 1).vehicles[0]
      ?.stockNumber,
  ).toBeNull();
  expect(
    beaversSnapshot([{ ...good, stock: "different" }], null, 1).accounting
      .recordsRejected,
  ).toBe(1);
});
