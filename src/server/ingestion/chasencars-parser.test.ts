import { expect, test } from "bun:test";
import {
  parseChasencarsCatalog,
  parseChasencarsOwner,
  parseChasencarsYard,
} from "./chasencars-parser";
import { chasencarsDate, chasencarsSnapshot } from "./chasencars-snapshot";
import {
  chasencarsFixture,
  chasencarsTestRecord,
} from "./chasencars-test-fixtures";
import { CHASENCARS_CATALOG } from "./chasencars-yard-metadata";

test("Chase N Cars complete native DOM report preserves661 donors,19 actual rejects and three older serials", () => {
  parseChasencarsOwner(chasencarsFixture("owner"));
  parseChasencarsYard(chasencarsFixture("yard"));
  const catalog = parseChasencarsCatalog(chasencarsFixture("inventory"));
  const result = chasencarsSnapshot(catalog, null);
  expect(catalog.records).toHaveLength(680);
  expect(result.vehicles).toHaveLength(661);
  expect(result.vehicles.filter((row) => row.vin.length < 17)).toHaveLength(3);
  expect(result.accounting).toEqual({
    recordsProcessed: 680,
    recordsRejected: 19,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  });
  expect(result.errors).toEqual([]);
  expect(result.rejected).toHaveLength(19);
  expect(
    result.vehicles.find((row) => row.stockNumber === "STK001332"),
  ).toMatchObject({
    vin: "1FTSS34P26DA41405",
    year: 2006,
    make: "Ford",
    model: "E-350",
    color: "White",
    availableDate: "2026-02-15",
    row: "4",
    stateAbbr: "OK",
    detailsUrl: CHASENCARS_CATALOG,
  });
  expect(
    result.vehicles.find((row) => row.stockNumber === "STK002415"),
  ).toMatchObject({
    vin: "1X69D8W201530",
    year: 1978,
    make: "Chevrolet",
    model: "NOVA",
  });
});
test("Chase N Cars fails closed on partial tables, changed pagination, unowned cells and ownership spill", () => {
  const html = chasencarsFixture("inventory");
  for (const input of [
    html.slice(0, -50),
    html.replace("</tbody>", ""),
    html.replace('data-label="VIN"', 'data-label="ForeignVIN"'),
    html.replace('"iDisplayLength": 10', '"serverSide": true'),
    html.replace(
      "1FTSS34P26DA41405",
      '<a href="https://foreign.test/">1FTSS34P26DA41405</a>',
    ),
    html.replace(
      "</body>",
      '<iframe src="https://foreign.test/"></iframe></body>',
    ),
    html.replaceAll("6471 State", "6472 State"),
    html.replaceAll(
      "https://chasencarsauto.com/inventory/",
      "https://foreign.test/inventory/",
    ),
  ])
    expect(() => parseChasencarsCatalog(input)).toThrow();
  expect(() =>
    parseChasencarsOwner(
      chasencarsFixture("owner").replace(
        "Simply bring your tools, remove the part yourself",
        "Retail cars for sale",
      ),
    ),
  ).toThrow();
  expect(() =>
    parseChasencarsYard(
      chasencarsFixture("yard").replace(
        "We are a U-pull It Salvage Yard located Tulsa, Oklahoma",
        "Off-site supplier network",
      ),
    ),
  ).toThrow();
});
test("Chase N Cars optional metadata remains nullable without rejecting valid identity", () => {
  const rows = Array.from({ length: 550 }, (_, index) =>
    chasencarsTestRecord(index),
  );
  const result = chasencarsSnapshot(
    { updated: "11/14/26", records: rows },
    null,
  );
  expect(result.errors).toEqual([]);
  expect(result.vehicles[0]).toMatchObject({
    color: null,
    imageUrl: null,
    engine: null,
    stockNumber: "STK000000",
    row: "1",
  });
  expect(
    chasencarsSnapshot({ updated: "11/14/26", records: rows.slice(1) }, null)
      .errors,
  ).toContain("Chase N Cars accepted 549, below fixed source floor550");
});
test("Chase N Cars arrival dates cannot exceed the full report calendar date", () => {
  expect(chasencarsDate("12/01/26", "11/14/26")).toBeNull();
  expect(chasencarsDate("11/15/26", "11/14/26")).toBeNull();
  expect(chasencarsDate("01/01/27", "11/14/26")).toBeNull();
  expect(chasencarsDate("11/14/26", "11/14/26")).toBe("2026-11-14");
  expect(chasencarsDate("12/31/25", "01/01/26")).toBe("2025-12-31");
  expect(chasencarsDate("02/29/24", "03/01/24")).toBe("2024-02-29");
  expect(chasencarsDate("02/29/26", "03/01/26")).toBeNull();
  expect(chasencarsDate("01/01/26", "02/30/26")).toBeNull();
});
test("Chase N Cars applies whole-source rejection, duplicate and previous-run drift ceilings", () => {
  const rows = Array.from({ length: 600 }, (_, index) =>
    chasencarsTestRecord(index),
  );
  const first = rows[0];
  if (!first) throw new Error("Missing generated test record");
  expect(
    chasencarsSnapshot(
      {
        updated: "11/14/26",
        records: [
          ...rows,
          ...Array.from({ length: 67 }, (_, i) => ({
            ...chasencarsTestRecord(1000 + i),
            make: "",
          })),
        ],
      },
      null,
    ).errors,
  ).toContain("Chase N Cars rejection ratio exceeds10%");
  expect(
    chasencarsSnapshot(
      {
        updated: "11/14/26",
        records: [
          ...rows,
          ...Array.from({ length: 201 }, () => ({ ...first })),
        ],
      },
      null,
    ).errors,
  ).toContain("Chase N Cars duplicate ratio exceeds25%");
  expect(
    chasencarsSnapshot({ updated: "11/14/26", records: rows }, 1202).errors,
  ).toContain(
    "Chase N Cars inventory violates the previous-run50% drift limit",
  );
  expect(
    chasencarsSnapshot({ updated: "11/14/26", records: rows }, 1201).errors,
  ).toEqual([]);
});
test("Chase N Cars retains every usable rejected or conflicting VIN/serial without repairing native identity", () => {
  const one = chasencarsTestRecord(1),
    two = chasencarsTestRecord(2);
  const legacy = { ...one, vin: "1X69D8W201530", year: "1978" };
  const result = chasencarsSnapshot(
    {
      updated: "11/14/26",
      records: [
        { ...one, make: "" },
        two,
        { ...two, make: "CHEVROLET" },
        legacy,
        { ...legacy, year: "2005" },
      ],
    },
    null,
  );
  expect(result.vehicles).toEqual([]);
  expect(result.accounting.recordsRejected).toBe(5);
  expect(result.observedVins).toEqual([one.vin, two.vin, legacy.vin].sort());
  expect(result.rejected).toHaveLength(5);
  const stockConflict = chasencarsSnapshot(
    { updated: "11/14/26", records: [one, { ...two, stock: one.stock }] },
    null,
  );
  expect(stockConflict.observedVins).toEqual([one.vin, two.vin].sort());
  expect(stockConflict.vehicles).toEqual([]);
});
