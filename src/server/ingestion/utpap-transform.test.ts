import { expect, test } from "bun:test";
import { parseUtpapDonor, transformUtpapDonor } from "./utpap-transform";
import { utpapTestRecord } from "./utpap-test-fixtures";

const photo = "https://utpap.com/Ogden-inventory-photos/A039820.jpeg";
test("Utah emits required donor identity when optional metadata and photo are absent", () => {
  const result = parseUtpapDonor(
    { ...utpapTestRecord, COLOR: "UNKNOWN", VEHICLE_ROW: "", YARD_DATE: "" },
    null,
    "1064",
  );
  expect(result.status).toBe("available");
  if (result.status !== "available")
    throw new Error("Expected available donor");
  expect(
    transformUtpapDonor(
      result.donor,
      "1064",
      null,
      "https://junkyardindex.com",
    ),
  ).toMatchObject({
    vin: utpapTestRecord.VIN,
    year: 2004,
    make: "Acura",
    model: "MDX",
    stockNumber: "A039820",
    color: null,
    row: null,
    availableDate: null,
    imageUrl: null,
  });
});
test("Utah preserves donor identity, date and native matching inventory destination", () => {
  const result = parseUtpapDonor(utpapTestRecord, photo, "1064");
  expect(result.status).toBe("available");
  if (result.status !== "available") throw new Error("Expected complete donor");
  const vehicle = transformUtpapDonor(
    result.donor,
    "1064",
    "a".repeat(64),
    "https://junkyardindex.com",
  );
  expect(vehicle).toMatchObject({
    source: "utpap",
    vin: "2HNYD18664H504098",
    color: "Gray",
    stockNumber: "A039820",
    row: "128",
    availableDate: "2026-10-28T00:00:00.000Z",
    detailsUrl:
      "https://utpap.com/search-inventory_ogden.php?make=ACURA&model=",
    imageUrl:
      "https://junkyardindex.com/api/inventory-photos/" + "a".repeat(64),
    locationCode: "1064",
    lat: 41.2364008,
    lng: -111.9913269,
  });
});
test.each([
  { VIN: "2HNYD18664H50409" },
  { MAKE: "ATV / MOTORCYCLE", MODEL: "HONDA" },
  { STOCKNUMBER: "K039820" },
  { S3CLIENTID: "1065" },
])("Utah rejects incomplete donor fields: %j", (changes) => {
  expect(
    parseUtpapDonor({ ...utpapTestRecord, ...changes }, photo, "1064").status,
  ).toBe("incomplete");
});
test("Utah accepts a genuine pre-1981 serial and never repairs a modern VIN", () => {
  const record = { ...utpapTestRecord, iYEAR: "1975", VIN: "CKM145F435985" };
  expect(parseUtpapDonor(record, photo, "1064").status).toBe("available");
  expect(
    parseUtpapDonor({ ...record, iYEAR: "1981" }, photo, "1064").status,
  ).toBe("incomplete");
});
test("Utah nulls invalid optional photos from another native yard or stock", () => {
  for (const value of [
    "https://example.com/" + utpapTestRecord.STOCKNUMBER + ".jpeg",
    photo.replace("A039820", "A039846"),
    photo.replace("Ogden", "Orem"),
    "https://utpap.com/&unsupported;",
  ])
    expect(parseUtpapDonor(utpapTestRecord, value, "1064")).toMatchObject({
      status: "available",
      donor: { photoUrl: null },
    });
});

test("Utah nulls invalid optional values without changing required donor identity", () => {
  const result = parseUtpapDonor(
    {
      ...utpapTestRecord,
      COLOR: "UNKNOWN",
      VEHICLE_ROW: "0",
      YARD_DATE: "2026-02-30T13:05:49.677",
    },
    photo,
    "1064",
  );
  expect(result.status).toBe("available");
  if (result.status !== "available")
    throw new Error("Expected available donor");
  expect(result.donor).toMatchObject({
    color: null,
    row: null,
    availableDate: null,
    photoUrl: photo,
  });
  expect(() =>
    transformUtpapDonor(
      result.donor,
      "1064",
      null,
      "https://junkyardindex.com",
    ),
  ).toThrow("preserved content hash");
  expect(() =>
    transformUtpapDonor(
      { ...result.donor, photoUrl: null },
      "1064",
      "a".repeat(64),
      "https://junkyardindex.com",
    ),
  ).toThrow("preserved content hash");
});

test("Utah accepts native set timestamps with whole seconds", () => {
  expect(
    parseUtpapDonor(
      { ...utpapTestRecord, YARD_DATE: "2026-04-18T18:10:44" },
      photo,
      "1064",
    ).status,
  ).toBe("available");
});
