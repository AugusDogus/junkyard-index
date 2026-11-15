import { describe, expect, test } from "bun:test";
import { parseByotResponse } from "./byot-parser";
import { BYOT_YARDS } from "./byot-configuration";
import { BYOT_QUERIES, byotSearchUrl } from "./byot-directory";
import { byotRecord, transformByotRecord } from "./byot-record";
import { byotMissingF150, byotValue } from "./byot-test-fixtures";

const yard = BYOT_YARDS[0];
describe("BYOT native boundaries", () => {
  test("keeps only available vehicles, including vehicles without photos", () => {
    expect(
      byotValue(
        parseByotResponse(
          JSON.stringify({
            search_id: null,
            data: {
              availableVehicles: [byotMissingF150],
              compatibleVehicles: [{ StockId: "OTHER" }],
            },
          }),
          "search",
        ),
      ),
    ).toEqual([byotMissingF150]);
    expect(
      byotValue(
        parseByotResponse(
          '{"search_id":null,"data":{"availableVehicles":[],"compatibleVehicles":[]}}',
          "search",
        ),
      ),
    ).toEqual([]);
  });
  test.each([
    "{}",
    '{"data":{"compatibleVehicles":[]}}',
    '{"status":500,"message":"failed"}',
    "<html>challenge</html>",
  ])("rejects an incomplete or blocked response: %s", (raw) => {
    expect(parseByotResponse(raw, "search").ok).toBe(false);
  });
  test("rejects capped arrivals and wrong envelopes", () => {
    expect(
      parseByotResponse(
        JSON.stringify(Array.from({ length: 5000 }, () => byotMissingF150)),
        "arrivals",
      ).ok,
    ).toBe(false);
    expect(parseByotResponse('{"data":[]}', "arrivals").ok).toBe(false);
  });
  test("accepts older serials and null dates, rejects invalid modern identities and wrong yards", () => {
    expect(
      byotRecord({ ...byotMissingF150, VIN: "4J332624", Year: 1955 }, yard)
        ?.VIN,
    ).toBe("4J332624");
    for (const VIN of [
      "NA",
      "KMHEC4A49D083848",
      "11111111111111111",
      "1FTRW07683KA65768",
    ])
      expect(byotRecord({ ...byotMissingF150, VIN }, yard)).toBeNull();
    expect(
      byotRecord({ ...byotMissingF150, StockId: "BMT044158" }, yard),
    ).toBeNull();
    expect(byotRecord({ ...byotMissingF150, Make: " " }, yard)).toBeNull();
    const record = byotRecord({ ...byotMissingF150, YardDtTm: null }, yard);
    if (!record) throw new Error("Valid fixture was rejected");
    expect(transformByotRecord(record, yard)).toMatchObject({
      availableDate: null,
      imageUrl: null,
      locationCity: "Elm Mott",
      detailsUrl: yard.inventoryUrl,
    });
  });
  test("searches Jeep exceptions and the older Jeep truck under JEEP", () => {
    for (const model of [
      "WRANGLER",
      "COMPASS",
      "RENEGADE",
      "JEEP TRUCK",
      "JEEP STATION WAGON",
    ]) {
      const index = BYOT_QUERIES.findIndex(
        (query) => query.make === "JEEP" && query.model === model,
      );
      expect(index).toBeGreaterThanOrEqual(0);
      expect(
        new URL(byotSearchUrl(yard.code, index)).searchParams.get("make"),
      ).toBe("JEEP");
    }
  });
});

test("new pagination or API error controls stop a search instead of silently truncating it", () => {
  const response = {
    search_id: null,
    data: { availableVehicles: [], compatibleVehicles: [] },
  };
  expect(
    parseByotResponse(
      JSON.stringify({ ...response, next_cursor: "page-2" }),
      "search",
    ).ok,
  ).toBe(false);
  expect(
    parseByotResponse(JSON.stringify({ ...response, status: 500 }), "search")
      .ok,
  ).toBe(false);
  expect(
    parseByotResponse(
      JSON.stringify({
        ...response,
        data: { ...response.data, hasMore: true },
      }),
      "search",
    ).ok,
  ).toBe(false);
});

test("missing optional photos do not reject an otherwise complete native donor", () => {
  const { images, ...withoutPhotos } = byotMissingF150;
  expect(images).toEqual([]);
  expect(byotRecord(withoutPhotos, yard)?.images).toEqual([]);
  expect(byotRecord({ ...withoutPhotos, images: null }, yard)?.images).toEqual(
    [],
  );
});
