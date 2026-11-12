import { expect, test } from "bun:test";
import {
  joinUtpapCatalog,
  parseUtpapMakes,
  parseUtpapMakePage,
  parseUtpapXml,
} from "./utpap-parser";
import {
  utpapTestPage,
  utpapTestRecord,
  utpapTestXml,
} from "./utpap-test-fixtures";

test("Utah joins complete native XML to exact-stock photos and source set dates", () => {
  const records = parseUtpapXml(utpapTestXml(), "1064");
  expect(records).toEqual([utpapTestRecord]);
  const html = utpapTestPage();
  expect(parseUtpapMakes(html)).toEqual(["ACURA"]);
  const photos = parseUtpapMakePage(html, "1064", "ACURA");
  expect(joinUtpapCatalog(records, photos)[0]).toEqual({
    record: utpapTestRecord,
    photo: "https://utpap.com/Ogden-inventory-photos/A039820.jpeg",
  });
});

test.each([
  ["truncated root", (xml: string) => xml.replace("</INVENTORY>", "")],
  ["partial donor", (xml: string) => xml.replace("</ASSET>", "")],
  [
    "duplicated field",
    (xml: string) =>
      xml.replace("<COLOR>", "<VIN>2HNYD18664H504098</VIN><COLOR>"),
  ],
  [
    "external declaration",
    (xml: string) =>
      xml.replace(
        "<INVENTORY>",
        '<!DOCTYPE x SYSTEM "https://example.com/x"><INVENTORY>',
      ),
  ],
  [
    "wrong yard",
    (xml: string) => xml.replace("<S3CLIENTID>1064", "<S3CLIENTID>1065"),
  ],
  [
    "unpublished availability",
    (xml: string) => xml.replace("<iSTATUS>0", "<iSTATUS>1"),
  ],
])("Utah rejects %s", (_label, rewrite) => {
  expect(() => parseUtpapXml(rewrite(utpapTestXml()), "1064")).toThrow();
});

test("Utah rejects repeated stock identities and differing native controls", () => {
  expect(() =>
    parseUtpapXml(utpapTestXml([utpapTestRecord, utpapTestRecord]), "1064"),
  ).toThrow("stock");
  const records = parseUtpapXml(utpapTestXml(), "1064");
  for (const page of [
    utpapTestPage({ stock: "A039821" }),
    utpapTestPage().replace(">2004<", ">2005<"),
  ])
    expect(() =>
      joinUtpapCatalog(records, parseUtpapMakePage(page, "1064", "ACURA")),
    ).toThrow("disagree");
});

test("Utah rejects placeholders as photos while retaining their donor in the denominator", () => {
  const rows = parseUtpapMakePage(
    utpapTestPage({ photo: "Ogden-inventory-photos/coming-soon.png" }),
    "1064",
    "ACURA",
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.photo).toBeNull();
});

test("Utah retains missing optional XML fields and blank native controls as null metadata", () => {
  const xml = utpapTestXml()
    .replace(/<COLOR>[^<]*<\/COLOR>/, "")
    .replace(/<VEHICLE_ROW>[^<]*<\/VEHICLE_ROW>/, "")
    .replace(/<YARD_DATE>[^<]*<\/YARD_DATE>/, "");
  const records = parseUtpapXml(xml, "1064");
  const page = utpapTestPage({
    photo: "Ogden-inventory-photos/coming-soon.png",
  })
    .replace(">128<", "><")
    .replace(">10.28.26<", "><");
  const joined = joinUtpapCatalog(
    records,
    parseUtpapMakePage(page, "1064", "ACURA"),
  );
  expect(joined[0]).toEqual({
    record: { ...utpapTestRecord, COLOR: "", VEHICLE_ROW: "", YARD_DATE: "" },
    photo: null,
  });
});

test("Utah normalizes invalid optional photo sources to null", () => {
  const rows = parseUtpapMakePage(
    utpapTestPage({ photo: "https://example.com/donor.jpeg" }),
    "1064",
    "ACURA",
  );
  expect(rows[0]?.photo).toBeNull();
});

test("Utah ignores ambiguous or malformed optional photo references", () => {
  for (const page of [
    utpapTestPage().replace("</a>", '<img src="extra.jpeg"></a>'),
    utpapTestPage({ photo: "https://utpap.com/&unsupported;" }),
  ]) {
    const rows = parseUtpapMakePage(page, "1064", "ACURA");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.photo).toBeNull();
  }
});

test("Utah nulls contradictory optional controls while preserving stock and YMM parity", () => {
  const records = parseUtpapXml(utpapTestXml(), "1064");
  const page = utpapTestPage({ date: "10.29.26" }).replace(">128<", ">129<");
  const joined = joinUtpapCatalog(
    records,
    parseUtpapMakePage(page, "1064", "ACURA"),
  );
  expect(joined[0]?.record).toEqual({
    ...utpapTestRecord,
    VEHICLE_ROW: "",
    YARD_DATE: "",
  });
});

test("Utah joins literal HTML ampersands while requiring escaped XML fields", () => {
  const record = { ...utpapTestRecord, MODEL: "TOWN & COUNTRY" };
  const xml = utpapTestXml([record]);
  const page = utpapTestPage().replaceAll("MDX", "TOWN & COUNTRY");
  expect(
    joinUtpapCatalog(
      parseUtpapXml(xml, "1064"),
      parseUtpapMakePage(page, "1064", "ACURA"),
    ),
  ).toHaveLength(1);
  expect(() =>
    parseUtpapXml(xml.replace("TOWN &amp; COUNTRY", "TOWN & COUNTRY"), "1064"),
  ).toThrow("ampersand");
});
