import { expect, test } from "bun:test";
import { VinplusRecordUnion } from "./vinplus-record-union";
import { vinplusStableRecord, type VinplusRecord } from "./vinplus-protocol";
const record: VinplusRecord = {
  stock: "STK24644",
  year: 2007,
  yardLocation: "195 Used Auto Parts",
  sourceSystem: "crush",
  make: "OLDSMOBILE",
  model: "ALERO",
  vin: "1G3NL52F14C163918",
  daysInYard: 30,
};
test("query overlap counts once without changing published YMM", () => {
  const census = VinplusRecordUnion.create();
  census.add([record]);
  census.add([{ ...record, daysInYard: 31 }]);
  expect(census.records()).toHaveLength(1);
  expect(census.records()[0]?.make).toBe("OLDSMOBILE");
  expect(census.yearCount(2007)).toBe(1);
});
test("maximum multiplicity preserves repeated backend rows without summing query overlap", () => {
  const census = VinplusRecordUnion.create();
  census.add([record, record]);
  census.add([record]);
  expect(census.records()).toHaveLength(2);
  census.add([record, record, record]);
  expect(census.records()).toHaveLength(3);
  expect(census.yearCount(2007)).toBe(3);
});
test("a conflicting stock version retains its whole evidence rather than silently deduplicating", () => {
  const census = VinplusRecordUnion.create();
  census.add([record]);
  census.add([{ ...record, color: "RED", year: 2008 }]);
  expect(census.records()).toHaveLength(2);
  expect(census.yearCount(2007)).toBe(1);
  expect(census.yearCount(2008)).toBe(1);
});
test("YardSmart photo signature rotation preserves identity but filename or host drift does not", () => {
  const photo = (token: string, file = "car.jpg") =>
    `https://api.yardsmartapp.com/rails/active_storage/blobs/redirect/${token}/${file}`;
  const original = {
    ...record,
    sourceSystem: "yardsmart",
    imageUrl: photo("opening"),
    imageUrls: [photo("opening")],
  };
  const rotated = {
    ...original,
    imageUrl: photo("closing"),
    imageUrls: [photo("closing")],
  };
  expect(vinplusStableRecord(rotated)).toEqual(vinplusStableRecord(original));
  expect(
    vinplusStableRecord({
      ...rotated,
      imageUrl: photo("closing", "other.jpg"),
    }),
  ).not.toEqual(vinplusStableRecord(original));
  expect(
    vinplusStableRecord({
      ...rotated,
      imageUrl: photo("closing").replace("api.yardsmartapp.com", "example.com"),
    }),
  ).not.toEqual(vinplusStableRecord(original));
  expect(
    vinplusStableRecord({ ...rotated, sourceSystem: "crush" }),
  ).not.toEqual(vinplusStableRecord({ ...original, sourceSystem: "crush" }));
});
