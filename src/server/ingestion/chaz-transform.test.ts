import { expect, test } from "bun:test";
import {
  chazFixtureMake,
  chazFixtureModel,
  chazFixtureModelPage,
  chazFixtureRecord,
} from "./chaz-test-fixtures";
import { parseChazModel } from "./chaz-parser";
import { transformChazRecord } from "./chaz-transform";

const context = { make: "ACURA", model: "ILX" };
test("Chaz transforms native fields and nulls missing or invalid optional stock, image and date", () => {
  const record = chazFixtureRecord(1);
  record[5] = "ST1/ST1_123.jpg";
  record[6] = "2026-10-22";
  const result = transformChazRecord(record, context);
  expect(result.status).toBe("available");
  if (result.status !== "available") throw new Error("Expected native donor");
  expect(result.vehicle).toMatchObject({
    source: "chaz",
    make: "Acura",
    model: "ILX",
    stateAbbr: "MD",
    stockNumber: "ST1",
    availableDate: "2026-10-22",
    lat: 39.6747856,
    lng: -77.2116775,
    imageUrl:
      "https://da8h1v3w8q6n5.cloudfront.net/md08/images/ST1/ST1_123.jpg",
  });
  const missing = parseChazModel(
    chazFixtureModelPage([record]).replace("<b>Stock:</b> ST1<br/>", ""),
    chazFixtureMake,
    chazFixtureModel,
  ).records[0];
  if (!missing) throw new Error("Expected optional-stock row");
  expect(transformChazRecord(missing, context)).toMatchObject({
    status: "available",
    vehicle: { stockNumber: null, imageUrl: null },
  });
  record[3] = "UNKNOWN";
  record[5] = "https://example.com/ST1.jpg";
  record[6] = "2026-02-31";
  expect(transformChazRecord(record, context)).toMatchObject({
    status: "available",
    vehicle: { stockNumber: null, availableDate: null, imageUrl: null },
  });
});

test("Chaz validates required identity and literal stock/year destinations without deriving YMM from routes", () => {
  const record = chazFixtureRecord(1);
  record[4] = "/parts/ACURA/PUBLISHED_VARIANT/ST1/2003";
  expect(transformChazRecord(record, context)).toMatchObject({
    status: "available",
    vehicle: { model: "ILX" },
  });
  record[4] = "/parts/ACURA/ILX/OTHER/2003";
  expect(transformChazRecord(record, context)).toMatchObject({
    status: "incomplete",
    vin: record[0],
  });
  record[4] = "https://example.com/parts/ACURA/ILX/ST1/2003";
  expect(transformChazRecord(record, context).status).toBe("incomplete");
  record[4] = "/parts/ACURA/ILX/ST1/1979";
  record[0] = "ABC123";
  record[1] = "1979";
  expect(transformChazRecord(record, context).status).toBe("available");
  record[1] = "1981";
  expect(transformChazRecord(record, context).status).toBe("incomplete");
});
