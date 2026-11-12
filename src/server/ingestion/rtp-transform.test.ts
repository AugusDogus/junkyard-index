import { expect, test } from "bun:test";
import { RtpRecordSchema, type RtpRecord } from "./rtp-client";
import { rtpTestRecord, rtpTestYard } from "./rtp-test-fixtures";
import { transformRtpRecord } from "./rtp-transform";

test("RTP preserves padded stocks, published date and filtered inventory destination", () => {
  const result = transformRtpRecord(rtpTestRecord, rtpTestYard);
  expect(result.status).toBe("available");
  if (result.status !== "available")
    throw new Error("Expected complete fixture");
  expect(result.vehicle).toMatchObject({
    source: "rtp",
    stockNumber: "000000109287",
    color: "Black",
    row: "207",
    availableDate: "2026-09-08T00:00:00.000Z",
    locationCode: "595",
    stateAbbr: "KY",
    detailsUrl:
      "https://upullandsave.com/lexington-ky/rtp-pick-a-part/inventory/2010/Chevrolet/Tahoe/",
    imageUrl: rtpTestRecord.images?.[0]?.full,
  });
});

const optionalRecords: {
  change: Partial<RtpRecord>;
  field: "color" | "stockNumber" | "row" | "availableDate" | "imageUrl";
}[] = [
  ...[
    "CIVIC",
    "2009",
    "NOT LISTED",
    "SIVLER",
    "white?",
    "RED&WITE",
    "Unknown",
    null,
  ].map((color) => ({ change: { color }, field: "color" as const })),
  { change: { stock_number: null }, field: "stockNumber" },
  { change: { stock_number: "invalid" }, field: "stockNumber" },
  { change: { images: [] }, field: "imageUrl" },
  { change: { yard_row: "" }, field: "row" },
  { change: { date_set: "2026-02-30 10:00:00" }, field: "availableDate" },
  { change: { date_set: "2026-09-08 24:00:00" }, field: "availableDate" },
  {
    change: {
      images: [
        { full: "https://upullandsave.com/yardsmart/595/999/6940706.jpg" },
      ],
    },
    field: "imageUrl",
  },
  {
    change: {
      images: [
        { full: "https://example.com/yardsmart/595/386619/6940706.jpg" },
      ],
    },
    field: "imageUrl",
  },
];
test.each(optionalRecords)(
  "RTP admits required fields and nulls absent or invalid optional metadata: %j",
  ({ change, field }) => {
    const result = transformRtpRecord(
      { ...rtpTestRecord, ...change },
      rtpTestYard,
    );
    expect(result.status).toBe("available");
    if (result.status !== "available")
      throw new Error("Expected available donor");
    expect(result.vehicle[field]).toBeNull();
    expect(result.vehicle.vin).toBe(rtpTestRecord.vin);
  },
);

test("RTP admits a donor when every optional field is omitted", () => {
  const record = RtpRecordSchema.parse({
    id: rtpTestRecord.id,
    yard_id: rtpTestRecord.yard_id,
    year: rtpTestRecord.year,
    make: rtpTestRecord.make,
    model: rtpTestRecord.model,
    vin: rtpTestRecord.vin,
    active: rtpTestRecord.active,
    status: rtpTestRecord.status,
  });
  const result = transformRtpRecord(record, rtpTestYard);
  expect(result.status).toBe("available");
  if (result.status !== "available")
    throw new Error("Expected available donor");
  expect(result.vehicle).toMatchObject({
    color: null,
    stockNumber: null,
    row: null,
    availableDate: null,
    imageUrl: null,
  });
});

const incompleteRecords: Partial<RtpRecord>[] = [
  { year: "" },
  { make: "" },
  { make: "Other" },
  { model: "" },
  { model: "Unknown" },
  { yard_id: "232" },
];
test.each(incompleteRecords)(
  "RTP rejects incomplete listings while preserving independent VIN evidence: %j",
  (change) => {
    expect(
      transformRtpRecord({ ...rtpTestRecord, ...change }, rtpTestYard),
    ).toEqual({ status: "incomplete", vin: rtpTestRecord.vin });
  },
);

test("RTP accepts genuine pre-1981 serials and rejects malformed modern identities", () => {
  expect(
    transformRtpRecord(
      { ...rtpTestRecord, year: "1975", vin: "F10YRV12345" },
      rtpTestYard,
    ).status,
  ).toBe("available");
  expect(
    transformRtpRecord({ ...rtpTestRecord, vin: "F10YRV12345" }, rtpTestYard),
  ).toEqual({ status: "incomplete", vin: null });
});

test("RTP explicit unavailable records provide no presence evidence", () => {
  expect(
    transformRtpRecord({ ...rtpTestRecord, active: "0" }, rtpTestYard),
  ).toEqual({ status: "unavailable" });
  expect(
    transformRtpRecord(
      { ...rtpTestRecord, status: "crushed", active: "0" },
      rtpTestYard,
    ),
  ).toEqual({ status: "unavailable" });
});

test.each(["DARK GREY", "WHITE/BLUE", "2 TONE BLUE"])(
  "RTP retains explicit compound colors: %s",
  (color) => {
    expect(
      transformRtpRecord({ ...rtpTestRecord, color }, rtpTestYard).status,
    ).toBe("available");
  },
);

test("RTP does not infer availability from an unrecognized active status", () => {
  expect(
    transformRtpRecord({ ...rtpTestRecord, status: "unexpected" }, rtpTestYard),
  ).toEqual({ status: "incomplete", vin: rtpTestRecord.vin });
});
