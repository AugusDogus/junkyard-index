import { expect, test } from "bun:test";
import {
  parseSix03Catalog,
  parseSix03Contact,
  parseSix03Detail,
  parseSix03RestPage,
  six03Hash,
  Six03DetailSchema,
  type Six03Detail,
} from "./six03-parser";
import {
  six03NativeFixtures,
  six03FixtureDetail,
  six03RestFixtures,
} from "./six03-test-fixtures";
import { transformSix03Record } from "./six03-transform";
import {
  SIX03_YARD,
  SIX03_CONFLICTING_ORGANIZATION,
} from "./six03-yard-metadata";

const fixtures = six03NativeFixtures();
const catalog = parseSix03Catalog(fixtures.catalog);
const post = (path: string) => {
  const value = catalog.posts.find(([candidate]) => candidate === path);
  if (!value) throw new Error("Missing native six03 control " + path);
  return value;
};

test("603 reads all locally revealed controls and the ten displaced native article observations", () => {
  expect(catalog.posts).toHaveLength(1033);
  expect(catalog.embedded).toHaveLength(10);
  expect(catalog.posts.filter((row) => !row[2])).toHaveLength(1);
  expect(catalog.embedded[0]?.fields).toContainEqual(["Stock #", "TESTPY"]);
  expect(catalog.embedded[0]?.fields).toContainEqual(["VIN", ""]);
  expect(
    catalog.posts.every((row) => row[0].startsWith("/parts-vehicles/")),
  ).toBe(true);
});

test("603 retains the contact's native 233 Main physical yard and separately records conflicting Organization metadata", () => {
  expect(parseSix03Contact(fixtures.contact)).toMatch(/^[a-f0-9]{64}$/);
  expect(SIX03_YARD).toMatchObject({
    code: "plaistow",
    address: "233 Main St",
    lat: 42.8545693,
    lng: -71.1094333,
  });
  expect(SIX03_CONFLICTING_ORGANIZATION.address).toBe(
    "5 Westville Road, Plaistow, NH 03865",
  );
  expect(() =>
    parseSix03Contact(
      fixtures.contact.replaceAll("233 Main St", "5 Westville Road"),
    ),
  ).toThrow("Visit Us");
});

test("603 preserves repeated native make words and ordinary native Civic model without model cleanup", () => {
  const cases: [string, string][] = [
    ["/parts-vehicles/2005-infiniti-fx-white/", "Infiniti FX"],
    ["/parts-vehicles/2007-jeep-commander-black/", "Jeep Commander"],
    ["/parts-vehicles/2020-honda-civic/", "Civic"],
  ];
  cases.forEach(([path, expectedModel]) => {
    const control = post(path);
    const record = parseSix03Detail(six03FixtureDetail(path), control);
    const result = transformSix03Record(record, control);
    expect(result.status).toBe("available");
    if (result.status !== "available")
      throw new Error("Native identity unexpectedly rejected");
    expect(result.vehicle.model).toBe(expectedModel);
    expect(record.headings).toHaveLength(2);
  });
});

test("603 primary structured heading conflict rejects its donor without a preferred winner", () => {
  const path = "/parts-vehicles/2020-honda-civic/";
  const raw = six03FixtureDetail(path).replace(
    "2020 Honda Civic | Vehicle Record",
    "2020 Honda Accord | Vehicle Record",
  );
  const record = parseSix03Detail(raw, post(path));
  expect(transformSix03Record(record, post(path)).status).toBe("incomplete");
});

test("603 rejects native page truncation, duplicate Unit Data and foreign canonical destinations", () => {
  const path = "/parts-vehicles/2020-honda-civic/";
  const raw = six03FixtureDetail(path);
  const unit = /<div class="vr-unit-data">[\s\S]*?<\/table>\s*<\/div>/.exec(
    raw,
  )?.[0];
  if (!unit) throw new Error("Missing native Unit Data fixture");
  expect(() =>
    parseSix03Detail(raw.replace("</html>", ""), post(path)),
  ).toThrow("truncated");
  expect(() =>
    parseSix03Detail(raw.replace(unit, unit + unit), post(path)),
  ).toThrow("Unit Data");
  expect(() =>
    parseSix03Detail(
      raw.replace(
        'rel="canonical" href="https://603autosalvage.com/',
        'rel="canonical" href="https://example.com/',
      ),
      post(path),
    ),
  ).toThrow("canonical");
  expect(() =>
    parseSix03Detail(raw.replace("</table>", ""), post(path)),
  ).toThrow();
});

test("603 detects control count changes, hidden donors and new remote continuation instead of following page two", () => {
  expect(() =>
    parseSix03Catalog(
      fixtures.catalog.replace("1033 Vehicles", "1034 Vehicles"),
    ),
  ).toThrow("count");
  expect(() =>
    parseSix03Catalog(
      fixtures.catalog.replace(
        "if(added>=12)break",
        'fetch("/new-list/");if(added>=12)break',
      ),
    ),
  ).toThrow("reveal graph");
  expect(() =>
    parseSix03Catalog(
      fixtures.catalog.replace("</body>", '<div class="pv-card"></div></body>'),
    ),
  ).toThrow("coverage");
  expect(() =>
    parseSix03Catalog(
      fixtures.catalog.replace(
        '<div class="pv-load-more">',
        '<a rel="next" href="/parts-vehicles/page/2/">Next</a><div class="pv-load-more">',
      ),
    ),
  ).toThrow("continuation");
});

test("603 projection fingerprint rejects changed raw retained claims", () => {
  const path = "/parts-vehicles/2020-honda-civic/";
  const record = parseSix03Detail(six03FixtureDetail(path), post(path));
  expect(
    Six03DetailSchema.safeParse({
      ...record,
      fields: [...record.fields, ["VIN", "1HGCM82633A004352"]],
    }).success,
  ).toBe(false);
});

test("603 rejects new head and numeric query continuations while classifying only the displaced native WordPress pair", () => {
  expect(() =>
    parseSix03Catalog(
      fixtures.catalog.replace(
        "</head>",
        '<link rel="next" href="/parts-vehicles/?page=2"></head>',
      ),
    ),
  ).toThrow("head continuation");
  expect(() =>
    parseSix03Catalog(
      fixtures.catalog.replace(
        "</body>",
        '<a href="/parts-vehicles/?batch=2">2</a></body>',
      ),
    ),
  ).toThrow("continuation");
  const path = "/parts-vehicles/2020-honda-civic/";
  const raw = six03FixtureDetail(path);
  expect(() =>
    parseSix03Detail(
      raw.replace("</head>", '<link rel="next" href="?page=2"></head>'),
      post(path),
    ),
  ).toThrow("head continuation");
  expect(() =>
    parseSix03Detail(
      raw.replace("</main>", '<a href="?page=2">2</a></main>'),
      post(path),
    ),
  ).toThrow("continuation");
  for (const extra of [
    '<a href="/parts-vehicles/?slice=2">2</a>',
    '<a href="/more-donors/">Next</a>',
    '<button data-cursor="new">2</button>',
    '<nav class="pagination"><a href="/more-donors/">2</a></nav>',
  ]) {
    expect(() =>
      parseSix03Catalog(fixtures.catalog.replace("</body>", extra + "</body>")),
    ).toThrow();
    expect(() =>
      parseSix03Detail(raw.replace("</body>", extra + "</body>"), post(path)),
    ).toThrow();
  }
});

test("603 malformed or ambiguous optional assertions become null without rejecting a valid donor", () => {
  const path = "/parts-vehicles/2020-honda-civic/";
  const raw = six03FixtureDetail(path);
  const image = /<img\b[^>]*id="main-vehicle-img"[^>]*>/.exec(raw)?.[0];
  if (!image) throw new Error("Missing native optional image");
  const cases: [string, "stockNumber" | "engine" | "imageUrl"][] = [
    [raw.replace("707230904</td>", "S".repeat(501) + "</td>"), "stockNumber"],
    [raw.replace("2.0L 4-Cylinder</td>", "E".repeat(501) + "</td>"), "engine"],
    [
      raw.replace(
        image,
        image.replace(/src="[^"]*"/, 'src="' + "x".repeat(1001) + '"'),
      ),
      "imageUrl",
    ],
    [raw.replace(image, image + image), "imageUrl"],
    [
      raw.replace(
        image,
        image.replace("src=", 'src="https://example.com/other.jpg" src='),
      ),
      "imageUrl",
    ],
    [
      raw.replace(image, image.replace("id=", 'id="conflicting-image" id=')),
      "imageUrl",
    ],
  ];
  for (const [html, field] of cases) {
    const record = parseSix03Detail(html, post(path));
    const result = transformSix03Record(record, post(path));
    expect(result.status).toBe("available");
    if (result.status !== "available")
      throw new Error("Optional metadata rejected a native donor");
    expect(result.vehicle[field]).toBeNull();
  }
});

const rest = six03RestFixtures().pages;
const fields = (record: Six03Detail) =>
  six03Hash([
    record.path,
    record.kind,
    record.fields,
    record.headings,
    record.image,
  ]);

test("603 REST census covers exactly the catalog roster with every donor-page field", () => {
  const details = rest.flatMap(
    (page, index) =>
      parseSix03RestPage(page.body, index + 1, page, catalog).details,
  );
  expect(details).toHaveLength(1033);
  expect(new Set(details.map((record) => record.path))).toEqual(
    new Set(catalog.posts.map(([path]) => path)),
  );
  // Every donor with a saved donor page parses to the same fields, headings
  // and photo from its REST article.
  const excerpts = new Set(catalog.embedded.map((record) => record.path));
  let compared = 0;
  for (const record of details) {
    if (
      excerpts.has(record.path) &&
      record.path !== "/parts-vehicles/2007-jeep-commander-black/"
    )
      continue;
    expect(fields(record)).toBe(
      fields(
        parseSix03Detail(six03FixtureDetail(record.path), post(record.path)),
      ),
    );
    compared++;
  }
  expect(compared).toBe(1024);
  // The catalog's excerpts carry the same Unit Data values as the articles.
  for (const excerpt of catalog.embedded) {
    const article = details.find((record) => record.path === excerpt.path);
    expect(new Map(article?.fields)).toEqual(new Map(excerpt.fields));
  }
});

test("603 REST pages refuse unexpected shape, protected or foreign donors and short pages", () => {
  const page = rest[0];
  if (!page) throw new Error("Missing saved REST page");
  const items: Record<string, unknown>[] = JSON.parse(page.body);
  const parse = (value: unknown, census = page) =>
    parseSix03RestPage(JSON.stringify(value), 1, census, catalog);
  const first = items[0];
  if (!first) throw new Error("Missing saved REST donor");
  expect(parse(items).details).toHaveLength(100);
  for (const altered of [
    { ...first, status: "publish" },
    { ...first, content: { rendered: "", protected: true } },
    { ...first, id: "99958" },
    { ...first, link: "https://example.com/parts-vehicles/2000-ford-ranger/" },
    { ...first, slug: "2000-ford-ranger-2" },
  ])
    expect(() => parse([altered, ...items.slice(1)])).toThrow();
  expect(() => parse(items.slice(1))).toThrow("expected 100");
  expect(() => parse([items[1], first, ...items.slice(2)])).toThrow(
    "descending id order",
  );
  expect(() => parse({ items })).toThrow();
  expect(() => parse(items, { ...page, total: 1032 })).toThrow(
    "but the catalog lists 1033",
  );
  expect(() => parseSix03RestPage(page.body, 12, page, catalog)).toThrow(
    "outside its 11-page census",
  );
});

test("603 REST articles ignore markup inside script, style and comment text, like donor pages", () => {
  const page = rest[0];
  if (!page) throw new Error("Missing saved REST page");
  const items: { content: { rendered: string } }[] = JSON.parse(page.body);
  const decoys =
    '<!-- <h1>Draft heading</h1> --><script>var x=\'<a href="/">Next</a><img id="main-vehicle-img" src="/decoy.jpg">\';</script><style>.x{}</style>';
  const altered = items.map((item) => ({
    ...item,
    content: { ...item.content, rendered: decoys + item.content.rendered },
  }));
  const fields = (raw: string) =>
    parseSix03RestPage(raw, 1, page, catalog).details.map((record) =>
      six03Hash([record.fields, record.headings, record.image]),
    );
  expect(fields(JSON.stringify(altered))).toEqual(fields(page.body));
});
