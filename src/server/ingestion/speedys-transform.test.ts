import { describe, expect, test } from "bun:test";
import { parseSpeedysCatalog, parseSpeedysDetail } from "./speedys-parser";
import { speedysSaved } from "./speedys-test-fixtures";
import {
  speedysSnapshot,
  transformSpeedysRecord,
  validateSpeedysSnapshot,
} from "./speedys-transform";
import { SPEEDYS_CATALOG } from "./speedys-yard-metadata";

function record(raw = speedysSaved.detail) {
  const post = parseSpeedysCatalog(speedysSaved.default, SPEEDYS_CATALOG)
    .posts[0];
  if (!post) throw new Error("Missing saved native donor");
  return parseSpeedysDetail(raw, post);
}
describe("Speedys source-native identity", () => {
  test("uses native identity and leaves every unjoined optional field empty", () => {
    const result = transformSpeedysRecord(record());
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error("Saved donor rejected");
    expect(result.vehicle).toEqual({
      source: "speedys",
      vin: "JN8AS5MV6BW668679",
      year: 2011,
      make: "Nissan",
      model: "Rogue",
      stockNumber: "1",
      imageUrl: null,
      color: null,
      availableDate: null,
      locationCode: "richmond",
      locationName: "Speedy's Transmission",
      locationCity: "Richmond",
      state: "Virginia",
      stateAbbr: "VA",
      lat: 37.507737999999996,
      lng: -77.4950018,
      detailsUrl: "https://parts.speedysgroup.com/car/?car=1",
      partsUrl: null,
      pricesUrl: null,
      engine: null,
      trim: null,
      transmission: null,
      section: null,
      row: null,
      space: null,
    });
    expect(result.vehicle.imageUrl).toBeNull();
  });
  test.each([
    ["manufacturer", "Manufacturer: TOYOTA, Model: "],
    ["model", "Manufacturer: , Model: Sentra"],
    ["year", "Manufacturer: , Model: , Year: 2012"],
  ])(
    "rejects genuinely conflicting %s claims while preserving VIN presence",
    (_name, extra) => {
      const parsed = record(
        speedysSaved.detail.replace("Manufacturer: , Model: ", extra),
      );
      expect(transformSpeedysRecord(parsed)).toEqual({
        status: "incomplete",
        observedVins: ["JN8AS5MV6BW668679"],
      });
      expect(() => validateSpeedysSnapshot(speedysSnapshot([parsed]))).toThrow(
        /10%/,
      );
    },
  );
  test("does not repair invalid literal VIN or a malformed heading year", () => {
    expect(
      transformSpeedysRecord(
        record(speedysSaved.detail.replace("JN8AS5MV6BW668679", "0000")),
      ),
    ).toEqual({ status: "incomplete", observedVins: [] });
    expect(
      transformSpeedysRecord(
        record(speedysSaved.detail.replace("<b>2011</b>", "<b>0</b>")),
      ),
    ).toEqual({ status: "incomplete", observedVins: ["JN8AS5MV6BW668679"] });
  });
});
