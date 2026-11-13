import { expect, test } from "bun:test";
import {
  aplusFixtureMake,
  aplusFixtureModel,
  aplusFixtureModelPage,
  aplusFixtureRecord,
} from "./aplus-test-fixtures";
import { parseAplusModel } from "./aplus-parser";
import { transformAplusRecord } from "./aplus-transform";

const context = { make: "ACURA", model: "ILX" };
test("Aplus transforms native fields and nulls missing or invalid optional stock, image and date", () => {
  const record = aplusFixtureRecord(1);
  record[5] = "ST1/ST1_123.jpg";
  record[6] = "2026-10-22";
  const result = transformAplusRecord(record, context);
  expect(result.status).toBe("available");
  if (result.status !== "available") throw new Error("Expected native donor");
  expect(result.vehicle).toMatchObject({
    source: "aplus",
    make: "Acura",
    model: "ILX",
    stateAbbr: "KY",
    stockNumber: "ST1",
    availableDate: "2026-10-22",
    lat: 37.9340629,
    lng: -84.559118,
    imageUrl:
      "https://da8h1v3w8q6n5.cloudfront.net/qq91/images/ST1/ST1_123.jpg",
  });
  const missing = parseAplusModel(
    aplusFixtureModelPage([record]).replace("<b>Stock:</b> ST1<br/>", ""),
    aplusFixtureMake,
    aplusFixtureModel,
  ).records[0];
  if (!missing) throw new Error("Expected optional-stock row");
  expect(transformAplusRecord(missing, context)).toMatchObject({
    status: "available",
    vehicle: { stockNumber: null, imageUrl: null },
  });
  record[3] = "UNKNOWN";
  record[5] = "https://example.com/ST1.jpg";
  record[6] = "2026-02-31";
  expect(transformAplusRecord(record, context)).toMatchObject({
    status: "available",
    vehicle: { stockNumber: null, availableDate: null, imageUrl: null },
  });
});

test("Aplus validates required identity and literal year destinations and nullable contradictory stock without deriving YMM from routes", () => {
  const record = aplusFixtureRecord(1);
  record[4] = "/parts/ACURA/PUBLISHED_VARIANT/ST1/2003";
  expect(transformAplusRecord(record, context)).toMatchObject({
    status: "available",
    vehicle: { model: "ILX" },
  });
  record[4] = "/parts/ACURA/ILX/OTHER/2003";
  expect(transformAplusRecord(record, context)).toMatchObject({
    status: "available",
    vehicle: { stockNumber: null, imageUrl: null },
  });
  record[4] = "https://example.com/parts/ACURA/ILX/ST1/2003";
  expect(transformAplusRecord(record, context).status).toBe("incomplete");
  record[4] = "/parts/ACURA/ILX/ST1/1979";
  record[0] = "ABC123";
  record[1] = "1979";
  expect(transformAplusRecord(record, context).status).toBe("available");
  record[1] = "1981";
  expect(transformAplusRecord(record, context).status).toBe("incomplete");
});

test("A Plus delimits native arrival aliases only when the whole supplied label matches provider formatting", () => {
  const record = aplusFixtureRecord(1);
  record[2] = "NISSAN/DATSUN KICKS";
  record[4] = "/parts/NISSAN.DATSUN/KICKS/ST1/2003";
  expect(transformAplusRecord(record, { make: "", model: "" })).toMatchObject({
    status: "available",
    vehicle: { make: "Nissan/Datsun", model: "KICKS" },
  });
  record[2] = "MERCEDES-BENZ MERCEDES GLC-CLASS";
  record[4] = "/parts/MERCEDES~BENZ/MERCEDES_GLC~CLASS/ST1/2003";
  expect(transformAplusRecord(record, { make: "", model: "" })).toMatchObject({
    status: "available",
    vehicle: { model: "MERCEDES GLC-CLASS" },
  });
  record[2] = "MERCEDES-BENZ MERCEDES-BENZ GLE-CLASS";
  record[4] = "/parts/MERCEDES~BENZ/MERCEDES~BENZ_GLE~CLASS/ST1/2003";
  expect(transformAplusRecord(record, { make: "", model: "" })).toMatchObject({
    status: "available",
    vehicle: { model: "MERCEDES-BENZ GLE-CLASS" },
  });
  record[2] = "";
  expect(transformAplusRecord(record, { make: "", model: "" }).status).toBe(
    "incomplete",
  );
  record[2] = "MERCEDES-BENZ MERCEDES GL-CLASS";
  expect(transformAplusRecord(record, { make: "", model: "" }).status).toBe(
    "incomplete",
  );
});
