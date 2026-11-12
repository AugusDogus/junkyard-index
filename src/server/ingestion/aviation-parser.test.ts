import { expect, test } from "bun:test";
import {
  parseAviationContact,
  parseAviationDirectory,
  parseAviationModel,
  parseAviationRoot,
} from "./aviation-parser";
import {
  aviationFixtureCard,
  aviationFixtureContact,
  aviationFixtureDirectory,
  aviationFixtureMake,
  aviationFixtureModel,
  aviationFixtureModelPage,
  aviationFixtureRecord,
  aviationFixtureRoot,
} from "./aviation-test-fixtures";

test("Aviation preserves literal model paths, donor boundaries and optional native metadata", () => {
  const model = {
    ...aviationFixtureModel,
    path: "/used-parts/ACURA/TOWN_&_COUNTRY",
    label: "TOWN & COUNTRY",
    count: 1,
  };
  const record = aviationFixtureRecord(1);
  record[2] = "ACURA TOWN & COUNTRY";
  record[4] = "/used-parts/ACURA/TOWN_&_COUNTRY/ST1/2003";
  record[5] = "ST1/ST1_0.jpg";
  record[6] = "2026-10-22";
  expect(
    parseAviationDirectory(
      aviationFixtureDirectory([model], "models"),
      "models",
      aviationFixtureMake,
    ),
  ).toEqual([model]);
  expect(
    parseAviationModel(
      aviationFixtureModelPage([record], model),
      aviationFixtureMake,
      model,
    ).records,
  ).toEqual([record]);
  expect(parseAviationRoot(aviationFixtureRoot([record])).records).toEqual([
    record,
  ]);
  expect(parseAviationContact(aviationFixtureContact)).toHaveLength(64);
});

test("Aviation does not filter placeholder VINs, images or rows above badge count", () => {
  const invalid = aviationFixtureRecord(1);
  invalid[0] = "-";
  invalid[3] = "AVAR";
  invalid[4] = "/used-parts/ACURA/ILX/AVAR/2003";
  invalid[5] = "https://aviationauto.com/placeholder.jpg";
  const records = [invalid, aviationFixtureRecord(2)];
  expect(
    parseAviationModel(aviationFixtureModelPage(records), aviationFixtureMake, {
      ...aviationFixtureModel,
      count: 1,
    }).records,
  ).toEqual(records);
});

test("Aviation rejects malformed scope, pagination and changed official ownership", () => {
  const raw = aviationFixtureModelPage([aviationFixtureRecord(1)]);
  expect(() =>
    parseAviationModel(
      raw.replace('data-type="vehicles"', 'data-type="parts"'),
      aviationFixtureMake,
      aviationFixtureModel,
    ),
  ).toThrow("vehicles region");
  expect(() =>
    parseAviationModel(
      raw.replace(
        "</div></body>",
        '<a class="page-link" href="?page=2">Next</a></div></body>',
      ),
      aviationFixtureMake,
      aviationFixtureModel,
    ),
  ).toThrow("continuation");
  expect(() =>
    parseAviationModel(
      raw.slice(0, -40),
      aviationFixtureMake,
      aviationFixtureModel,
    ),
  ).toThrow();
  expect(() =>
    parseAviationContact(
      aviationFixtureContact.replace("5231 East Drexel", "999 Wrong Road"),
    ),
  ).toThrow("physical address");
  expect(() =>
    parseAviationRoot(
      aviationFixtureRoot([aviationFixtureRecord(1)]).replace(
        '"makesBrowseUrl"',
        '"otherUrl"',
      ),
    ),
  ).toThrow("configured");
  expect(() =>
    parseAviationModel(
      raw.replace(aviationFixtureCard(aviationFixtureRecord(1)), ""),
      aviationFixtureMake,
      aviationFixtureModel,
    ),
  ).toThrow("empty");
});
