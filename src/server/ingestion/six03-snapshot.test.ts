import { expect, test } from "bun:test";
import {
  parseSix03Catalog,
  parseSix03Detail,
  Six03CatalogSchema,
  six03Hash,
  type Six03Post,
} from "./six03-parser";
import { six03Snapshot, validateSix03Snapshot } from "./six03-snapshot";
import { six03FixtureDetail, six03NativeFixtures } from "./six03-test-fixtures";

const catalog = parseSix03Catalog(six03NativeFixtures().catalog);
function post(path: string): Six03Post {
  const value = catalog.posts.find(([candidate]) => candidate === path);
  if (!value) throw new Error("Missing native source control");
  return value;
}
const civic = post("/parts-vehicles/2020-honda-civic/");
const tacoma = post("/parts-vehicles/2020-toyota-tacoma-brown/");
function subset(posts: Six03Post[]) {
  return Six03CatalogSchema.parse({
    ...catalog,
    posts,
    embedded: [],
    projection: six03Hash([catalog.hash, catalog.runtime, posts, []]),
  });
}

test("603 quarantines every occurrence sharing a VIN across distinct owned donor destinations, even with identical YMM", () => {
  const first = parseSix03Detail(six03FixtureDetail(civic[0]), civic);
  const other: Six03Post = [
    "/parts-vehicles/second-civic/",
    civic[1],
    civic[2],
    civic[3],
    civic[4],
  ];
  const second = parseSix03Detail(
    six03FixtureDetail(civic[0]).replaceAll(civic[0], other[0]),
    other,
  );
  const snapshot = six03Snapshot(subset([civic, other]), [first, second]);
  expect(snapshot.vehicles).toHaveLength(0);
  expect(snapshot.accounting).toEqual({
    recordsProcessed: 2,
    recordsExcluded: 0,
    recordsRejected: 2,
    duplicateVehicles: 0,
  });
  expect(snapshot.observedVins).toEqual(["2HGFC2F84LH570904"]);
});

test("603 quarantines multiple valid VINs on one donor and preserves all valid rejected presence", () => {
  const raw = six03FixtureDetail(civic[0]);
  const vinRow =
    /<tr>\s*<td[^>]*><strong>VIN<\/strong><\/td>\s*<td[^>]*>2HGFC2F84LH570904<\/td>\s*<\/tr>/.exec(
      raw,
    )?.[0];
  if (!vinRow) throw new Error("Missing native VIN row");
  const record = parseSix03Detail(
    raw.replace(
      vinRow,
      vinRow + vinRow.replace("2HGFC2F84LH570904", "1HGCM82633A004352"),
    ),
    civic,
  );
  const snapshot = six03Snapshot(subset([civic]), [record]);
  expect(snapshot.vehicles).toHaveLength(0);
  expect(snapshot.accounting.recordsRejected).toBe(1);
  expect(snapshot.observedVins).toEqual([
    "1HGCM82633A004352",
    "2HGFC2F84LH570904",
  ]);
});

test("603 invalid optional VIN placeholder does not create a second valid VIN or recover a missing identity", () => {
  const raw = six03FixtureDetail(civic[0]);
  const vinRow =
    /<tr>\s*<td[^>]*><strong>VIN<\/strong><\/td>\s*<td[^>]*>2HGFC2F84LH570904<\/td>\s*<\/tr>/.exec(
      raw,
    )?.[0];
  if (!vinRow) throw new Error("Missing native VIN row");
  const record = parseSix03Detail(
    raw.replace(
      vinRow,
      vinRow + vinRow.replace("2HGFC2F84LH570904", "Not Available"),
    ),
    civic,
  );
  expect(six03Snapshot(subset([civic]), [record]).vehicles).toHaveLength(1);
  const missing = parseSix03Detail(
    raw.replaceAll("2HGFC2F84LH570904", ""),
    civic,
  );
  expect(
    six03Snapshot(subset([civic]), [missing]).accounting.recordsRejected,
  ).toBe(1);
});

test("603 does not repair native YMM from route words, VIN, title decorations or another donor", () => {
  const record = parseSix03Detail(
    six03FixtureDetail(civic[0]).replace(
      "2020 Honda Civic</td>",
      "2020 Honda Unknown</td>",
    ),
    civic,
  );
  const snapshot = six03Snapshot(subset([civic]), [record]);
  expect(snapshot.vehicles).toHaveLength(0);
  expect(snapshot.observedVins).toEqual(["2HGFC2F84LH570904"]);
  expect(() => validateSix03Snapshot(snapshot)).toThrow("below 324");
});

test("603 native Frontier structured variant and malformed Mazda remain required rejections", () => {
  const frontier = catalog.posts.find(
    (row) =>
      row[0].includes("frontier") &&
      six03NativeFixtures().details.some(
        ([path, raw]) =>
          path === row[0] && raw.includes("2014 Nissan Frontier SV 4"),
      ),
  );
  if (!frontier)
    throw new Error("Missing native Frontier required variant fixture");
  const mazda = post("/parts-vehicles/2014-mazda-cx-9-gray/");
  for (const control of [frontier, mazda]) {
    const record = parseSix03Detail(six03FixtureDetail(control[0]), control);
    const snapshot = six03Snapshot(subset([control]), [record]);
    expect(snapshot.accounting.recordsRejected).toBe(1);
    expect(snapshot.observedVins).toHaveLength(1);
  }
});

test("603 source guards reject excessive native rejections and duplicate counts without shrinking the universe", () => {
  const first = parseSix03Detail(six03FixtureDetail(civic[0]), civic);
  const second = parseSix03Detail(six03FixtureDetail(tacoma[0]), tacoma);
  const seed = six03Snapshot(subset([civic, tacoma]), [first, second]);
  const vehicles = Array.from({ length: 800 }, () => seed.vehicles[0]).filter(
    (vehicle) => vehicle !== undefined,
  );
  expect(() =>
    validateSix03Snapshot({
      ...seed,
      vehicles,
      accounting: {
        recordsProcessed: 890,
        recordsExcluded: 0,
        recordsRejected: 90,
        duplicateVehicles: 0,
      },
    }),
  ).toThrow("10%");
  expect(() =>
    validateSix03Snapshot({
      ...seed,
      vehicles,
      accounting: {
        recordsProcessed: 1100,
        recordsExcluded: 0,
        recordsRejected: 0,
        duplicateVehicles: 300,
      },
    }),
  ).toThrow("25%");
});
