import { expect, test } from "bun:test";
import { NorthwestRecord } from "./northwest-record";
import { transformNorthwestRecord } from "./northwest-transform";

// Same original RDX claims as 006-model-capture.json /rowChunks/0/rows/0.
const record = NorthwestRecord.schema.parse({
  occurrenceId: "NW-00003",
  sourceUrl: "https://northwestautoparts.com/parts/ACURA/RDX/",
  context: {
    kind: "model",
    make: { path: "/parts/ACURA", label: "ACURA" },
    model: { path: "/parts/ACURA/RDX/", label: "RDX" },
  },
  years: ["2010"],
  titles: ["ACURA RDX"],
  vins: ["5J8TB1H23AA002695"],
  inquiries: ["2010 ACURA RDX - VIN 5J8TB1H23AA002695"],
  destinations: ["//northwestautoparts.com/parts/ACURA/RDX/Q367/2010"],
  stockNumbers: ["Q367"],
});
const location = {
  code: "test-yard",
  name: "Test yard",
  city: "Test city",
  lat: 0,
  lng: 0,
};

test("candidate uses explicit caller geography and preserves source-native destination", () => {
  const result = transformNorthwestRecord(record, location);
  expect(result.status).toBe("candidate");
  if (result.status !== "candidate") return;
  expect(result.candidate).toMatchObject({
    source: "northwest",
    vin: "5J8TB1H23AA002695",
    year: 2010,
    make: "Acura",
    model: "RDX",
    stockNumber: "Q367",
    locationCode: location.code,
    locationName: location.name,
    locationCity: location.city,
    lat: location.lat,
    lng: location.lng,
    state: "Alaska",
    stateAbbr: "AK",
    detailsUrl: "https://northwestautoparts.com/parts/ACURA/RDX/Q367/2010",
    imageUrl: null,
    availableDate: null,
    color: null,
    section: null,
    row: null,
    space: null,
  });
});

test("synthetic optional conflicts become null diagnostics while identity survives", () => {
  const result = transformNorthwestRecord(
    {
      ...record,
      stockNumbers: ["Q367", "OTHER"],
      colors: ["RED", "BLUE"],
      rows: ["1", "2"],
      imageUrls: ["/one.jpg", "/two.jpg"],
      availableDates: ["2026-01-01", "2026-01-02"],
    },
    location,
  );
  expect(result.status).toBe("candidate");
  if (result.status !== "candidate") return;
  expect(result.candidate).toMatchObject({
    stockNumber: null,
    color: null,
    row: null,
    imageUrl: null,
    availableDate: null,
  });
  expect(result.optionalConflicts.map((value) => value.field)).toEqual([
    "stockNumber",
    "imageUrl",
    "availableDate",
    "color",
    "row",
  ]);
  expect(result.optionalConflicts[0]?.values).toEqual(["Q367", "OTHER"]);
});

test("synthetic malformed optional values never reject the native donor", () => {
  const result = transformNorthwestRecord(
    {
      ...record,
      stockNumbers: [],
      imageUrls: ["https://example.com/photo.jpg"],
      availableDates: ["2026-02-30"],
      colors: ["unknown"],
    },
    location,
  );
  expect(result.status).toBe("candidate");
  if (result.status !== "candidate") return;
  expect(result.candidate).toMatchObject({
    stockNumber: null,
    imageUrl: null,
    availableDate: null,
    color: null,
  });
  expect(result.candidate.detailsUrl).toEndWith("/Q367/2010");
});

test("synthetic valid supplied optional values survive without identity enrichment", () => {
  const result = transformNorthwestRecord(
    {
      ...record,
      imageUrls: ["/images/native.jpg"],
      availableDates: ["2024-02-29"],
      colors: ["RED"],
      sections: ["A"],
      rows: ["12"],
      spaces: ["3"],
    },
    location,
  );
  expect(result.status).toBe("candidate");
  if (result.status !== "candidate") return;
  expect(result.candidate).toMatchObject({
    imageUrl: "https://northwestautoparts.com/images/native.jpg",
    availableDate: "2024-02-29",
    color: "RED",
    section: "A",
    row: "12",
    space: "3",
  });
});

test("required rejection never produces a candidate", () => {
  const result = transformNorthwestRecord({ ...record, titles: [] }, location);
  expect(result.status).toBe("rejected");
  expect(result.candidate).toBeNull();
});
