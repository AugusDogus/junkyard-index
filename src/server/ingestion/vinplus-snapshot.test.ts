import { expect, test } from "bun:test";
import { VINPLUS_TENANTS } from "./vinplus-configuration";
import { inspectVinplusEvidence } from "./vinplus-parser";
import { vinplusSnapshot } from "./vinplus-snapshot";
import { vinplusCensus } from "./vinplus-test-fixtures";
import { inventoryVinWithCheckDigit } from "./inventory-vin-check-digit";
const tenant = VINPLUS_TENANTS[0];
if (!tenant) throw new Error("Missing Pocatello configuration");
const config = { ...tenant, minimum: 1 };
function records() {
  const result = inspectVinplusEvidence(config, vinplusCensus()[0] ?? []);
  if (result.kind !== "complete") throw new Error("Missing terminal fixture");
  const modern = result.records.filter(
    (record) =>
      typeof record.vin === "string" &&
      record.vin.length === 17 &&
      inventoryVinWithCheckDigit(record.vin, String(record.year)) !== null,
  );
  if (modern.length < 100) throw new Error("Missing valid modern VIN fixtures");
  return modern.slice(0, 100).map((record, i) => ({
    ...record,
    stock: `STK${String(i).padStart(6, "0")}`,
    year: 2003,
    make: "HONDA",
    model: "ACCORD",
  }));
}
test("10% rejection guard uses donors and retains genuine rejected presence", () => {
  const input = records().map((record, i) =>
    i < 10 ? { ...record, model: "Unknown" } : record,
  );
  const snapshot = vinplusSnapshot(config, input);
  expect(snapshot.accounting.recordsRejected).toBe(10);
  expect(snapshot.observedVins).toHaveLength(10);
  const example = input[0];
  if (!example) throw new Error("Missing record");
  input[10] = {
    ...example,
    stock: "STK000010",
    year: 2003,
    make: "HONDA",
    model: "Unknown",
  };
  expect(() => vinplusSnapshot(config, input)).toThrow("10% rejection");
});
test("invalid modern check digits reject donors and retain structural VIN presence", () => {
  const input = records();
  const example = input[0];
  if (!example) throw new Error("Missing record");
  input[0] = {
    ...example,
    stock: "STK011131",
    vin: "1FAFP5525YA159954",
    year: 2000,
    make: "FORD",
  };
  input[1] = { ...example, stock: "STK000001", vin: "1FAFP552IYA159954" };
  const snapshot = vinplusSnapshot(config, input);
  expect(snapshot.accounting.recordsRejected).toBe(2);
  expect(snapshot.vehicles).toHaveLength(98);
  expect(
    snapshot.vehicles.some((vehicle) => vehicle.vin === input[0]?.vin),
  ).toBe(false);
  expect(snapshot.observedVins).toEqual(["1FAFP5525YA159954"]);
});
test("eligible pre-1981 serials stay literal, with no modern VIN repair", () => {
  const input = records();
  const example = input[0];
  if (!example) throw new Error("Missing record");
  input[0] = {
    ...example,
    stock: "STK000000",
    vin: "ABC12345",
    year: 1980,
    make: "FORD",
    model: "F100",
  };
  expect(vinplusSnapshot(config, input).vehicles[0]?.vin).toBe("ABC12345");
  input[0] = {
    ...example,
    stock: "STK000000",
    vin: "ABC12345",
    year: 1981,
    make: "FORD",
    model: "F100",
  };
  expect(vinplusSnapshot(config, input).accounting.recordsRejected).toBe(1);
});
test("conflicting stock identities are one rejection with no asserted VIN", () => {
  const input = records();
  const original = input[0];
  if (!original) throw new Error("Missing record");
  input[1] = { ...original, vin: "1GCHK23U44F248109" };
  const snapshot = vinplusSnapshot(config, input);
  expect(snapshot.accounting.recordsProcessed).toBe(99);
  expect(snapshot.accounting.recordsRejected).toBe(1);
  expect(snapshot.observedVins).toEqual([]);
  expect(
    snapshot.vehicles.some((vehicle) => vehicle.stockNumber === original.stock),
  ).toBe(false);
});
test("distinct stocks sharing a VIN count as duplicates and cannot contradict YMM", () => {
  const input = records();
  const original = input[0];
  if (!original) throw new Error("Missing record");
  input[1] = { ...original, stock: "STK000001" };
  expect(vinplusSnapshot(config, input).accounting.duplicateVehicles).toBe(1);
  input[1] = { ...original, stock: "STK000001", year: 2004 };
  expect(() => vinplusSnapshot(config, input)).toThrow("contradict");
});
test("duplicate and physical-yard floors cannot be bypassed", () => {
  const input = records();
  const original = input[0];
  if (!original) throw new Error("Missing record");
  expect(() => vinplusSnapshot({ ...config, minimum: 101 }, input)).toThrow(
    "floor",
  );
  for (let i = 1; i <= 26; i++)
    input[i] = { ...original, stock: `STK${String(i).padStart(6, "0")}` };
  expect(() => vinplusSnapshot(config, input)).toThrow("25% duplicate");
});
test("US Auto Supply keeps its stock-bound photo from the frozen census", () => {
  const usAutoSupply = VINPLUS_TENANTS.find(
    (value) => value.yardId === "us_auto_supply",
  );
  const bodies = vinplusCensus()[2];
  if (!usAutoSupply || !bodies)
    throw new Error("Missing US Auto Supply census");
  const result = inspectVinplusEvidence(usAutoSupply, bodies);
  if (result.kind !== "complete") throw new Error("Incomplete census");
  const { vehicles } = vinplusSnapshot(usAutoSupply, result.records);
  expect(vehicles.length).toBeGreaterThan(0);
  for (const vehicle of vehicles)
    expect(vehicle.imageUrl).toBe(
      `https://usautosupplymi.com/inventory-photos/${vehicle.stockNumber}.jpg`,
    );
  const [first] = result.records;
  if (!first) throw new Error("Missing record");
  for (const imageUrl of [
    "https://usautosupplymi.com/inventory-photos/STK000001.jpg",
    `http://usautosupplymi.com/inventory-photos/${first.stock}.jpg`,
    `https://example.com/inventory-photos/${first.stock}.jpg`,
    null,
  ])
    expect(
      vinplusSnapshot({ ...usAutoSupply, minimum: 1 }, [{ ...first, imageUrl }])
        .vehicles[0]?.imageUrl,
    ).toBeNull();
});
test("tenants without a photo contract keep no photo", () => {
  const input = records().map((record) => ({
    ...record,
    imageUrl: `https://usautosupplymi.com/inventory-photos/${record.stock}.jpg`,
  }));
  expect(
    vinplusSnapshot(config, input).vehicles.every((v) => v.imageUrl === null),
  ).toBe(true);
});
