import { expect, test } from "bun:test";
import { ChesterfieldDonor } from "./chesterfield-donor";
import type { ChesterfieldRecord } from "./chesterfield-parser";
import { chesterfieldRecord } from "./chesterfield-test-fixtures";

test("admits genuine source fields without claiming a durable image", () => {
  const result = ChesterfieldDonor.parse(chesterfieldRecord);
  expect(result.status).toBe("available");
  if (result.status !== "available")
    throw new Error("Expected source donor fixture");
  expect(result.donor).toMatchObject({
    yard: "Fort Lee",
    vin: "1HGCB7669LA067658",
    year: 1990,
    make: "Honda",
    model: "Accord",
    color: "Gold",
    stockNumber: "000000085373",
    position: "Import 13 F",
    availableDate: "2026-10-20T00:00:00.000Z",
    photoUrl: chesterfieldRecord.images[0],
  });
});

const incompleteRecords: Partial<ChesterfieldRecord>[] = [
  { vin: "1HGCB766ILA067658" },
  { yard: "Other yard" },
  { position: "HOLD" },
  { position: "CRUSH" },
  { make: "Unknown" },
  { model: "Unknown" },
  { year: "not a year" },
];
test.each(incompleteRecords)(
  "rejects invalid required fields or inactive donors",
  (change) => {
    expect(
      ChesterfieldDonor.parse({ ...chesterfieldRecord, ...change }).status,
    ).toBe("incomplete");
  },
);

test("admits absent optional metadata as null without inventing values", () => {
  const result = ChesterfieldDonor.parse({
    ...chesterfieldRecord,
    color: "",
    stock: "",
    position: "",
    arrivalDate: "",
    images: [],
  });
  expect(result.status).toBe("available");
  if (result.status !== "available") throw new Error("Expected native donor");
  expect(result.donor).toMatchObject({
    color: null,
    stockNumber: null,
    position: null,
    availableDate: null,
    photoUrl: null,
    blobIdentity: null,
  });
});

test("invalid optional metadata remains null", () => {
  const result = ChesterfieldDonor.parse({
    ...chesterfieldRecord,
    color: "UNPUBLISHED",
    stock: "not a native stock",
    position: "Unknown",
    arrivalDate: "02/30/2026",
    images: ["https://other.example/image.jpg"],
  });
  expect(result.status).toBe("available");
  if (result.status !== "available") throw new Error("Expected native donor");
  expect(result.donor).toMatchObject({
    color: null,
    stockNumber: null,
    position: null,
    availableDate: null,
    photoUrl: null,
    blobIdentity: null,
  });
  const future = ChesterfieldDonor.parse({
    ...chesterfieldRecord,
    arrivalDate: "01/01/2099",
  });
  expect(future.status).toBe("available");
  if (future.status !== "available") throw new Error("Expected native donor");
  expect(future.donor.availableDate).toBeNull();
});

test("retains a genuine pre-1981 serial while rejecting a modern short identity", () => {
  expect(
    ChesterfieldDonor.parse({
      ...chesterfieldRecord,
      year: "1970",
      vin: "0F91H500001",
    }).status,
  ).toBe("available");
  expect(
    ChesterfieldDonor.parse({
      ...chesterfieldRecord,
      year: "1990",
      vin: "0F91H500001",
    }).status,
  ).toBe("incomplete");
});
