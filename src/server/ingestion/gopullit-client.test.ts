import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { GopullitInventoryPageSchema } from "./gopullit-client";

describe("GO Pull-It client decoding", () => {
  test("accepts complete and not-yet-enriched inventory records", () => {
    const records = Schema.decodeUnknownSync(GopullitInventoryPageSchema)([
      {
        id: 333591,
        title: "GPI0331270",
        created_at: "2026-08-18 20:19:59",
        gallery: [
          {
            thumbnail: "https://gopullit.com/car-600x600.jpg",
            full: "https://gopullit.com/car.jpg",
          },
        ],
        location: "107",
        make: "HONDA",
        model: "ACCORD",
        vin: "1HGCP2F79CA059766",
        yardCity: "JACKSONVILLE ",
        yardDate: "08/17/26",
        yardState: "FL",
        year: "2012",
      },
      {
        id: 333600,
        title: "203122103578",
        created_at: "2026-08-18 20:20:04",
        gallery: [],
      },
    ]);

    expect(records).toHaveLength(2);
    expect(records[1]?.vin).toBeUndefined();
  });

  test("rejects malformed page payloads", () => {
    expect(() =>
      Schema.decodeUnknownSync(GopullitInventoryPageSchema)({ records: [] }),
    ).toThrow();
  });
});
