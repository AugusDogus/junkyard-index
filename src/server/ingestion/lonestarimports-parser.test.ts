import { expect, test } from "bun:test";
import { lonestarimportsNative } from "./lonestarimports-test-fixtures";
import {
  parseLonestarimportsDocument,
  parseLonestarimportsPage,
} from "./lonestarimports-parser";
import {
  lonestarimportsInactive,
  lonestarimportsSnapshot,
} from "./lonestarimports-snapshot";

const rows = lonestarimportsNative.openingPages.flatMap(
  (raw) => parseLonestarimportsPage(raw).data,
);
test("actual complete primary opening/closing retains fields, counts and native controls", () => {
  expect(rows).toHaveLength(2560);
  expect(
    lonestarimportsNative.closingPages.map(parseLonestarimportsPage),
  ).toEqual(lonestarimportsNative.openingPages.map(parseLonestarimportsPage));
  for (const [index, raw] of lonestarimportsNative.openingDocuments.entries())
    expect(parseLonestarimportsDocument(raw, index)).toBe(
      parseLonestarimportsDocument(
        lonestarimportsNative.closingDocuments[index] ?? "",
        index,
      ),
    );
  const snapshot = lonestarimportsSnapshot(rows, null);
  expect(snapshot.errors).toEqual([]);
  expect(snapshot.vehicles).toHaveLength(2531);
  expect(snapshot.accounting).toEqual({
    recordsProcessed: 2560,
    recordsRejected: 9,
    recordsExcluded: 20,
    duplicateVehicles: 0,
  });
  expect(snapshot.vehicles.find((v) => v.vin === "10801412029308")?.year).toBe(
    1967,
  );
  expect(
    snapshot.vehicles.find((v) => v.stockNumber === "LS11016")?.detailsUrl,
  ).toBe("https://www.lonestarimport.com/new-arrivals?stock=LS11016");
});
test("category labels need a literal native make and retain the unresolved donor identity", () => {
  const snapshot = lonestarimportsSnapshot(rows, null);
  expect(snapshot.vehicles.find((v) => v.stockNumber === "LS5521")?.make).toBe(
    "GMC",
  );
  expect(snapshot.vehicles.find((v) => v.stockNumber === "LS0838")?.make).toBe(
    "Chevrolet",
  );
  expect(snapshot.vehicles.find((v) => v.stockNumber === "LS708")?.make).toBe(
    "Geo",
  );
  expect(snapshot.observedVins).toEqual(["1GAHG39R6Y1138058"]);
});
test("native whole-donor removals differ from component-only sale notes", () => {
  expect(rows.filter(lonestarimportsInactive)).toHaveLength(20);
  expect(rows.find((r) => r.Stock === "LS7101")?.Description).toContain(
    "TRANS SOLD",
  );
  expect(
    lonestarimportsSnapshot(rows, null).vehicles.some(
      (v) => v.stockNumber === "LS7101",
    ),
  ).toBe(true);
});

test("the captured LS549 SOLD4/9/98 donor is excluded from inventory and presence", () => {
  const sold = rows.find((row) => row.Stock === "LS549");
  if (!sold) throw new Error("Missing LS549 fixture");
  expect(lonestarimportsInactive(sold)).toBe(true);
  const snapshot = lonestarimportsSnapshot(rows, null);
  expect(snapshot.excluded.some((row) => row.Stock === "LS549")).toBe(true);
  expect(snapshot.vehicles.some((row) => row.stockNumber === "LS549")).toBe(
    false,
  );
  expect(snapshot.observedVins).not.toContain(sold.VIN);
});
