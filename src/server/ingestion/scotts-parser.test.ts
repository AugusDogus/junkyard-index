import { expect, test } from "bun:test";
import {
  parseScottsDirectory,
  parseScottsModel,
  parseScottsRoot,
} from "./scotts-parser";
import { transformScottsRecord } from "./scotts-transform";
import {
  scottsContext,
  scottsFixture,
  scottsMake,
  scottsModel,
} from "./scotts-test-fixtures";

test("Scotts parses actual complete native CC68 controls and donor identities", () => {
  expect(parseScottsRoot(scottsFixture("root"))).toHaveLength(64);
  expect(parseScottsDirectory(scottsFixture("makes"), "makes")).toHaveLength(
    34,
  );
  expect(
    parseScottsDirectory(scottsFixture("acura"), "models", scottsMake),
  ).toHaveLength(9);
  const page = parseScottsModel(scottsFixture("cl"), scottsMake, scottsModel);
  expect(page.records).toEqual([
    [
      "19UYA2256VL006073",
      "1997",
      "ACURA CL",
      "200165",
      "/used-parts/ACURA/CL/200165/1997",
      null,
      "200165",
    ],
    [
      "19UYA2254VL011689",
      "1997",
      "ACURA CL",
      "90075",
      "/used-parts/ACURA/CL/90075/1997",
      null,
      "90075",
    ],
  ]);
  const record = page.records[0];
  if (!record) throw new Error("Actual donor vanished");
  expect(transformScottsRecord(record, scottsContext)).toMatchObject({
    status: "available",
    vehicle: {
      source: "scotts",
      stateAbbr: "CO",
      locationCity: "Fort Collins",
      vin: "19UYA2256VL006073",
      year: 1997,
      make: "Acura",
      model: "CL",
      imageUrl: null,
      color: null,
      availableDate: null,
    },
  });
});

test("Scotts refuses source, physical identity, scope and document boundary changes", () => {
  for (const html of [
    scottsFixture("cl").replaceAll("CC68,XX00", "DD15"),
    scottsFixture("cl").replaceAll("938 West Willox Lane", "Other yard"),
    scottsFixture("cl")
      .replaceAll("970-498-0662", "000-000-0000")
      .replaceAll("9704980662", "0000000000"),
    scottsFixture("cl").replace("</html>", ""),
    scottsFixture("cl").replace(
      "Some vehicles may not show parts available",
      "All parts are brokered",
    ),
  ])
    expect(() => parseScottsModel(html, scottsMake, scottsModel)).toThrow();
  expect(() =>
    parseScottsRoot(
      scottsFixture("root").replaceAll(
        "makes/#aps-search-by-makes",
        "hidden/#aps-search-by-makes",
      ),
    ),
  ).toThrow("directory");
});

test("Scotts names a badged model that returns the native No Results page", () => {
  // Nov 23: SATURN/VUE, badged 3 in its make menu, returned a page without
  // the scope banner and failed only as "scope assertion changed"; hours
  // later it listed the same three donors.
  const vue = { path: "/used-parts/SATURN/VUE", label: "VUE", count: 3 };
  const saturn = { path: "/used-parts/SATURN", label: "SATURN", count: 7 };
  expect(() =>
    parseScottsModel(scottsFixture("no-results"), saturn, vue),
  ).toThrow(
    'Scotts SATURN VUE advertises 3 donors but returned the native "No Results" page',
  );
});

test("Scotts refuses unclassified continuation, omitted cards and foreign destinations", () => {
  const raw = scottsFixture("cl");
  for (const control of [
    '<nav class="pagination"><a href="?page=2">2</a></nav>',
    '<a href="?batch=2">2</a>',
    '<button data-cursor="next">More</button>',
  ])
    expect(() =>
      parseScottsModel(
        raw.replace("</body>", control + "</body>"),
        scottsMake,
        scottsModel,
      ),
    ).toThrow(/continuation|pagination/);
  expect(() =>
    parseScottsModel(
      raw.replaceAll("aps-la-card-wrapper", "unknown-wrapper"),
      scottsMake,
      scottsModel,
    ),
  ).toThrow("wrappers");
  expect(() =>
    parseScottsModel(
      raw.replaceAll(
        "https://hondapartsused.com/used-parts/ACURA/CL/200165/1997",
        "https://example.com/used-parts/ACURA/CL/200165/1997",
      ),
      scottsMake,
      scottsModel,
    ),
  ).toThrow("foreign");
});

test("Scotts retains native CC68 photos using required donor ID when optional stock is missing", () => {
  const mdx = parseScottsDirectory(
    scottsFixture("acura"),
    "models",
    scottsMake,
  ).find((model) => model.label === "MDX");
  if (!mdx) throw new Error("Actual MDX control missing");
  const page = parseScottsModel(scottsFixture("mdx"), scottsMake, mdx);
  const row = page.records.find((record) => record[5] !== null);
  if (!row) throw new Error("Actual CC68 photo missing");
  const photo = row[5];
  const result = transformScottsRecord(
    [row[0], row[1], row[2], "", row[4], photo, row[6]],
    { ...scottsContext, model: "MDX" },
  );
  expect(result.status).toBe("available");
  if (result.status !== "available")
    throw new Error("Missing optional stock rejected real identity");
  expect(result.vehicle.stockNumber).toBeNull();
  expect(result.vehicle.imageUrl).toContain("/cc68/images/" + row[6] + "/");
  for (const image of [
    "https://example.com/photo.jpg",
    "../other/images/a.jpg",
    "999/999_1.jpg",
  ]) {
    const altered = transformScottsRecord(
      [row[0], row[1], row[2], row[3], row[4], image, row[6]],
      { ...scottsContext, model: "MDX" },
    );
    expect(altered.status).toBe("available");
    if (altered.status === "available")
      expect(altered.vehicle.imageUrl).toBeNull();
  }
});
