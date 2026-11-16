import { expect, test } from "bun:test";
import { parseBigdInventory, parseBigdYard } from "./bigd-parser";
import { bigdSnapshot } from "./bigd-snapshot";
import { BIGD_MINIMUM_INVENTORY } from "./bigd-yard-metadata";

import { bigdNative } from "./bigd-test-fixtures";

test("replays the complete Big D table with native check digits and a physical Idaho yard", () => {
  expect(parseBigdYard(bigdNative.contact).address).toBe("1296 E Iona Rd");
  const rows = parseBigdInventory(bigdNative.opening);
  expect(rows).toEqual(parseBigdInventory(bigdNative.closing));
  const snapshot = bigdSnapshot(rows, null);
  expect(rows).toHaveLength(295);
  expect(snapshot.vehicles).toHaveLength(288);
  expect(snapshot.accounting).toEqual({
    recordsProcessed: 295,
    recordsRejected: 7,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  });
  expect(snapshot.vehicles[0]).toMatchObject({
    vin: "5TBBT54178S460872",
    year: 2008,
    make: "Toyota",
    model: "TUNDRA",
    row: "22",
    stockNumber: null,
    imageUrl: null,
    availableDate: null,
    detailsUrl: null,
    stateAbbr: "ID",
  });
});

test.each([
  ["truncated document", (html: string) => html.replace(/<\/html>/i, "")],
  [
    "missing table",
    (html: string) => html.replace('id="vehicles"', 'id="missing"'),
  ],
  ["columns", (html: string) => html.replace(">VIN</th>", ">Serial</th>")],
  [
    "nested field",
    (html: string) =>
      html.replace(">5TBBT54178S460872</td>", "><b>5TBBT54178S460872</b></td>"),
  ],
  [
    "row label",
    (html: string) => html.replace('data-label="VIN"', 'data-label="Stock"'),
  ],
  [
    "pagination scope",
    (html: string) =>
      html.replace(
        "bLengthChange: true",
        "serverSide: true, bLengthChange: true",
      ),
  ],
  [
    "new pagination",
    (html: string) =>
      html.replace(
        "</tbody>",
        '</tbody><tfoot><a rel="next" href="?page=2">Next</a></tfoot>',
      ),
  ],
  [
    "physical ownership",
    (html: string) => html.replaceAll("1296 E. Iona Rd.", "999 Unknown Rd."),
  ],
] as const)("rejects %s", (_name, patch) =>
  expect(() => parseBigdInventory(patch(bigdNative.opening))).toThrow(),
);

test("rejects more than 10% invalid rows above the inventory floor", () => {
  const rows = parseBigdInventory(bigdNative.opening);
  const first = rows[0];
  if (!first) throw new Error("Missing saved Big D first row");
  expect(bigdSnapshot(rows, null).vehicles).toHaveLength(288);
  expect(() =>
    bigdSnapshot(
      [...rows, ...Array.from({ length: 40 }, () => ({ ...first, vin: "" }))],
      null,
    ),
  ).toThrow("288 accepted, 47 rejected");
});

test("keeps the source floor, duplicate, conflicting identity and prior-count guards", () => {
  const rows = parseBigdInventory(bigdNative.opening);
  const acceptedVins = new Set(
    bigdSnapshot(rows, null).vehicles.map((v) => v.vin),
  );
  const accepted = rows.filter((row) => acceptedVins.has(row.vin));
  expect(BIGD_MINIMUM_INVENTORY).toBe(96);
  expect(() => bigdSnapshot(accepted.slice(0, 95), null)).toThrow();
  expect(bigdSnapshot(accepted.slice(0, 96), null).vehicles).toHaveLength(96);
  expect(() => bigdSnapshot(rows, 600)).toThrow();
  expect(() => bigdSnapshot(rows, -1)).toThrow();
  const repeated = rows[0];
  if (!repeated) throw new Error("Missing saved Big D first row");
  expect(() =>
    bigdSnapshot(
      [...rows, ...Array.from({ length: 100 }, () => repeated)],
      null,
    ),
  ).toThrow();
  const result = bigdSnapshot(
    [...rows, { ...repeated, model: "CONFLICT" }],
    null,
  );
  expect(result.vehicles.some((v) => v.vin === repeated.vin)).toBe(false);
  expect(result.observedVins).toContain(repeated.vin);
  expect(result.accounting.recordsRejected).toBe(9);
  expect(
    bigdSnapshot([...rows, repeated], null).accounting.duplicateVehicles,
  ).toBe(1);
});

test("keeps optional values nullable and accepts legitimate pre-1981 serials", () => {
  const rows = parseBigdInventory(bigdNative.opening);
  const first = rows[0];
  if (!first) throw new Error("Missing Big D fixture row");
  const result = bigdSnapshot(
    [
      {
        ...first,
        year: "1979",
        make: "Ford",
        model: "W8000",
        vin: "W80DVEC8987",
        color: "???",
        row: "unknown",
      },
      ...rows.slice(1),
    ],
    null,
  );
  expect(result.vehicles[0]).toMatchObject({
    vin: "W80DVEC8987",
    year: 1979,
    make: "Ford",
    model: "W8000",
    row: null,
    color: null,
    stockNumber: null,
    availableDate: null,
  });
  const missing = bigdSnapshot(
    rows.map((r, i) => (i === 0 ? { ...r, make: "unknown" } : r)),
    null,
  );
  expect(missing.observedVins).toContain(first.vin);
  expect(missing.vehicles.some((v) => v.vin === first.vin)).toBe(false);
});
