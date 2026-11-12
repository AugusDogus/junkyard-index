import { expect, test } from "bun:test";
import {
  parseDdautoPublishedApp,
  parseDdautoSnapshot,
} from "./ddauto-glide-contract";
import { parseDdautoRows } from "./ddauto-parser";
import {
  ddautoTestOwner,
  ddautoTestPublished,
  ddautoTestRecord,
  ddautoTestRecords,
  ddautoTestRows,
  ddautoTestSnapshot,
} from "./ddauto-test-fixtures";
import { parseDdautoYard } from "./ddauto-yard-metadata";

test("DD Auto validates physical ownership, public table schema and active status legend", () => {
  expect(parseDdautoYard(ddautoTestOwner).code).toBe("logan");
  const snapshot = parseDdautoSnapshot(ddautoTestSnapshot);
  expect(() =>
    parseDdautoPublishedApp(ddautoTestPublished, snapshot.publishedAt),
  ).not.toThrow();
});

test.each([
  ["owner address", (s: string) => s.replace("1976 W 200 N", "1977 W 200 N")],
  ["owner coordinates", (s: string) => s.replace("41.7355957", "41.8")],
  [
    "owner inventory link",
    (s: string) =>
      s.replace("dd-auto-parts-cars.glide.page", "unknown.glide.page"),
  ],
  ["truncated owner", (s: string) => s.replace("</html>", "")],
] as const)("DD Auto rejects changed %s", (_name, rewrite) => {
  expect(() => parseDdautoYard(rewrite(ddautoTestOwner))).toThrow();
});

test.each([
  ["VIN field mapping", (s: string) => s.replace('"cnfEv"', '"other"')],
  [
    "protected field",
    (s: string) => s.replace('"isProtected":false', '"isProtected":true'),
  ],
  [
    "private ownership",
    (s: string) =>
      s.replace('"emailOwnersColumn":[]', '"emailOwnersColumn":["owner"]'),
  ],
  [
    "snapshot destination",
    (s: string) => s.replace("storage.googleapis.com", "example.com"),
  ],
] as const)("DD Auto rejects changed %s", (_name, rewrite) => {
  expect(() => parseDdautoSnapshot(rewrite(ddautoTestSnapshot))).toThrow();
});

test.each([
  [
    "active legend",
    (s: string) =>
      s.replace("IS AVAILABLE TO BUY PARTS FROM", "MAY BECOME AVAILABLE"),
  ],
  ["private app", (s: string) => s.replace('"disabled"', '"password"')],
  ["view table", (s: string) => s.replace('"table-ref"', '"other"')],
  [
    "publication version",
    (s: string) => s.replace("1781021574647", "1781021574648"),
  ],
] as const)("DD Auto rejects changed %s", (_name, rewrite) => {
  expect(() =>
    parseDdautoPublishedApp(rewrite(ddautoTestPublished), 1781021574647),
  ).toThrow();
});

test("DD Auto retains every donor status and reconciles independent make/status totals", () => {
  const records = [
    ddautoTestRecord,
    ...(["Premium Lot", "NOT AVAILABLE", "Killed"] as const).map((status) => ({
      ...ddautoTestRecord,
      status,
    })),
  ];
  const raw = ddautoTestRows([ddautoTestRecord]).replace(
    '"Parts"',
    '"Unknown"',
  );
  expect(() => parseDdautoRows(raw)).toThrow();
  expect(
    parseDdautoRows(ddautoTestRows(records)).records.map((r) => r.status),
  ).toEqual(["Parts", "Premium Lot", "NOT AVAILABLE", "Killed"]);
  expect(
    parseDdautoRows(
      ddautoTestRows(),
      parseDdautoSnapshot(ddautoTestSnapshot).colorColumn,
    ).records[0],
  ).toMatchObject({
    vin: ddautoTestRecord.vin,
    year: "2007",
    make: "Audi",
    model: "A4",
    color: "Black",
  });
});

test.each([
  ["truncated JSON", (s: string) => s.slice(0, -1)],
  [
    "mixed read times",
    (s: string) => s.replace("05:19:49.515828Z", "05:19:50.515828Z"),
  ],
  [
    "foreign document",
    (s: string) => s.replace("Ws6yVYonyVyaoiyrIvyP/tables", "wrongApp/tables"),
  ],
  ["duplicate row ID", (s: string) => s.replace('"row-1"', '"row-0"')],
  [
    "missing count control",
    (s: string) =>
      s.replace(
        '"jWUbL":{"stringValue":"Total"}',
        '"other":{"stringValue":"Total"}',
      ),
  ],
  [
    "count mismatch",
    (s: string) =>
      s.replace('"nWiGd":{"integerValue":"1"}', '"nWiGd":{"integerValue":"2"}'),
  ],
] as const)("DD Auto rejects %s", (_name, rewrite) => {
  expect(() => parseDdautoRows(rewrite(ddautoTestRows()))).toThrow();
});

test("DD Auto rejects a response reaching its native query bound", () => {
  expect(() => parseDdautoRows(ddautoTestRows(ddautoTestRecords(499)))).toThrow(
    "query bound",
  );
});
