import { expect, test } from "bun:test";
import { parseAwapPage } from "./awap-parser";
import { awapTestCard, awapTestPage } from "./awap-test-fixtures";
import {
  awapSnapshot,
  transformAwapRecord,
  validateAwapSnapshot,
} from "./awap-transform";
import { AWAP_CATALOG } from "./awap-yard-metadata";

const records = (cards: string[]) =>
  parseAwapPage(awapTestPage(1, cards.length, cards), AWAP_CATALOG).records;
test("AWAP required placeholders reject rows and preserve independently valid VINs", () => {
  for (const model of [
    "null",
    "none",
    "not specified",
    "unknown",
    "N/A",
    "-",
  ]) {
    const row = records([awapTestCard(1, { model })])[0];
    if (!row) throw new Error("Missing fixture record");
    expect(transformAwapRecord(row)).toEqual({
      status: "incomplete",
      observedVins: ["1HGCM82633A000001"],
    });
  }
});
test("AWAP supports native pre1981 serials, rejects modern fragments and never repairs identity", () => {
  const snapshot = awapSnapshot(
    records([
      awapTestCard(1, {
        year: "1979",
        make: "Jeep",
        model: "CJ-5",
        vin: "J9F83AC851237",
      }),
      awapTestCard(2, { vin: "1HGCM82633A" }),
    ]),
  );
  expect(snapshot.vehicles.map((vehicle) => vehicle.vin)).toEqual([
    "J9F83AC851237",
  ]);
  expect(snapshot.observedVins).toEqual([]);
  expect(snapshot.accounting.recordsRejected).toBe(1);
});
test("AWAP native VIN and explicit YMM contradictions fail the entire source", () => {
  for (const card of [
    awapTestCard(1, { title: "2004 Honda Accord" }),
    awapTestCard(1).replace(
      "inventory/?vin=1HGCM82633A000001",
      "inventory/?vin=1HGCM82633A000002",
    ),
  ]) {
    expect(() => awapSnapshot(records([card]))).toThrow("contradict");
  }
  expect(() =>
    awapSnapshot(
      records([awapTestCard(1), awapTestCard(2, { vin: "1HGCM82633A000001" })]),
    ),
  ).toThrow("reuse");
});
test("AWAP keeps the10% required rejection threshold with null optional metadata", () => {
  const cards = Array.from({ length: 10 }, (_, i) =>
    awapTestCard(i + 1, i === 0 ? { model: "unknown" } : {}),
  );
  const snapshot = awapSnapshot(records(cards));
  validateAwapSnapshot(snapshot);
  expect(snapshot.vehicles).toHaveLength(9);
  expect(snapshot.observedVins).toEqual(["1HGCM82633A000001"]);
  expect(snapshot.vehicles[0]).toMatchObject({
    stockNumber: null,
    color: null,
    imageUrl: null,
    availableDate: null,
    row: null,
    engine: null,
    transmission: null,
  });
  cards[1] = awapTestCard(2, { model: "unknown" });
  expect(() => validateAwapSnapshot(awapSnapshot(records(cards)))).toThrow(
    "10%",
  );
});
