import { expect, test } from "bun:test";
import { VINPLUS_TENANTS } from "./vinplus-configuration";
import { inspectVinplusEvidence } from "./vinplus-parser";
import { vinplusSnapshot } from "./vinplus-snapshot";
import { vinplusCensus } from "./vinplus-test-fixtures";
import { inventoryVinWithCheckDigit } from "./inventory-vin-check-digit";
const tenant = VINPLUS_TENANTS[0];
if (!tenant) throw new Error("Missing Pocatello configuration");
const config = { ...tenant, minimum: 1 };
// The frozen census was captured through 2026-11-13.
const asOf = Date.parse("2026-11-14T12:00:00Z");
const DAY = 86_400_000;
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
  const snapshot = vinplusSnapshot(config, input, asOf);
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
  expect(() => vinplusSnapshot(config, input, asOf)).toThrow("10% rejection");
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
  const snapshot = vinplusSnapshot(config, input, asOf);
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
  expect(vinplusSnapshot(config, input, asOf).vehicles[0]?.vin).toBe(
    "ABC12345",
  );
  input[0] = {
    ...example,
    stock: "STK000000",
    vin: "ABC12345",
    year: 1981,
    make: "FORD",
    model: "F100",
  };
  expect(vinplusSnapshot(config, input, asOf).accounting.recordsRejected).toBe(
    1,
  );
});
test("conflicting stock identities are one rejection with no asserted VIN", () => {
  const input = records();
  const original = input[0];
  if (!original) throw new Error("Missing record");
  input[1] = { ...original, vin: "1GCHK23U44F248109" };
  const snapshot = vinplusSnapshot(config, input, asOf);
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
  expect(
    vinplusSnapshot(config, input, asOf).accounting.duplicateVehicles,
  ).toBe(1);
  input[1] = { ...original, stock: "STK000001", year: 2004 };
  expect(() => vinplusSnapshot(config, input, asOf)).toThrow("contradict");
});
test("duplicate and physical-yard floors cannot be bypassed", () => {
  const input = records();
  const original = input[0];
  if (!original) throw new Error("Missing record");
  expect(() =>
    vinplusSnapshot({ ...config, minimum: 101 }, input, asOf),
  ).toThrow("floor");
  for (let i = 1; i <= 26; i++)
    input[i] = { ...original, stock: `STK${String(i).padStart(6, "0")}` };
  expect(() => vinplusSnapshot(config, input, asOf)).toThrow("25% duplicate");
});
test("US Auto Supply keeps its stock-bound photo once the yard has had time to upload it", () => {
  const usAutoSupply = VINPLUS_TENANTS.find(
    (value) => value.yardId === "us_auto_supply",
  );
  const bodies = vinplusCensus()[2];
  if (!usAutoSupply || !bodies)
    throw new Error("Missing US Auto Supply census");
  const result = inspectVinplusEvidence(usAutoSupply, bodies);
  if (result.kind !== "complete") throw new Error("Incomplete census");
  const { vehicles } = vinplusSnapshot(usAutoSupply, result.records, asOf);
  // Photos for arrivals from the last eight days still return 404.
  const recent = vehicles.filter(
    (vehicle) => (vehicle.availableDate ?? "") > "2026-11-06",
  );
  expect(recent).toHaveLength(310);
  for (const vehicle of recent) expect(vehicle.imageUrl).toBeNull();
  const older = vehicles.filter((vehicle) => !recent.includes(vehicle));
  expect(older.length).toBeGreaterThan(0);
  for (const vehicle of older)
    expect(vehicle.imageUrl).toBe(
      `https://usautosupplymi.com/inventory-photos/${vehicle.stockNumber}.jpg`,
    );
  const [first] = result.records;
  if (!first) throw new Error("Missing record");
  const photo = `https://usautosupplymi.com/inventory-photos/${first.stock}.jpg`;
  const single = (patch: Partial<typeof first>, at = asOf) =>
    vinplusSnapshot(
      { ...usAutoSupply, minimum: 1 },
      [{ ...first, ...patch }],
      at,
    ).vehicles[0]?.imageUrl;
  const added = Date.parse("2026-11-06T00:00:00Z");
  expect(single({ dateAdded: "2026-11-06T23:59:00" }, added + 8 * DAY)).toBe(
    photo,
  );
  expect(
    single({ dateAdded: "2026-11-06T00:00:00" }, added + 8 * DAY - 1),
  ).toBeNull();
  expect(single({ dateAdded: null })).toBeNull();
  for (const imageUrl of [
    "https://usautosupplymi.com/inventory-photos/STK000001.jpg",
    photo.replace("https:", "http:"),
    photo.replace("usautosupplymi.com", "example.com"),
    null,
  ])
    expect(single({ imageUrl })).toBeNull();
});
test("tenants without a photo contract keep no photo", () => {
  const input = records().map((record) => ({
    ...record,
    imageUrl: `https://usautosupplymi.com/inventory-photos/${record.stock}.jpg`,
  }));
  expect(
    vinplusSnapshot(config, input, asOf).vehicles.every(
      (v) => v.imageUrl === null,
    ),
  ).toBe(true);
});
