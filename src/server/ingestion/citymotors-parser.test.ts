import { expect, test } from "bun:test";
import {
  parseCitymotorsCatalog,
  parseCitymotorsDetail,
} from "./citymotors-parser";
import {
  citymotorsRecordVins,
  citymotorsSnapshot,
  transformCitymotorsRecord,
  validateCitymotorsSnapshot,
} from "./citymotors-transform";
import { CITYMOTORS_CATALOG } from "./citymotors-yard-metadata";
import {
  citymotorsFixtureCatalog,
  citymotorsFixtureDetail,
  citymotorsFixturePost,
} from "./citymotors-test-fixtures";

test("City Motors binds primary donor fields and ignores component recommendations", () => {
  const catalog = parseCitymotorsCatalog(
    citymotorsFixtureCatalog(),
    CITYMOTORS_CATALOG,
  );
  expect(catalog.posts).toEqual([citymotorsFixturePost]);
  const record = parseCitymotorsDetail(
    citymotorsFixtureDetail(),
    citymotorsFixturePost,
  );
  expect(record.heading).toBe("2020 BMW X7");
  expect(transformCitymotorsRecord(record)).toMatchObject({
    status: "available",
    vehicle: {
      vin: "5UXCW2C09L9B00683",
      year: 2020,
      make: "BMW",
      model: "X7",
      stockNumber: null,
    },
  });
});
test("City Motors accepts complete native cache comments after the document", () => {
  expect(
    parseCitymotorsCatalog(
      citymotorsFixtureCatalog() + "<!-- Page cached by LiteSpeed Cache -->",
      CITYMOTORS_CATALOG,
    ).posts,
  ).toHaveLength(1);
  expect(() =>
    parseCitymotorsCatalog(
      citymotorsFixtureCatalog() + "<!-- unclosed cache trailer",
      CITYMOTORS_CATALOG,
    ),
  ).toThrow();
});

test("City Motors preserves full-title Year cells and nullable repeated optional fields", () => {
  const record = parseCitymotorsDetail(
    citymotorsFixtureDetail({
      year: "2020 BMW X7",
      extraFields:
        "<tr><td>Exterior color:</td><td>Engine text</td></tr><tr><td>Interior color:</td><td>White</td></tr><tr><td>Interior color:</td><td>Black</td></tr>",
    }),
    citymotorsFixturePost,
  );
  expect(record.fields[0]).toEqual(["Year", "2020 BMW X7"]);
  expect(transformCitymotorsRecord(record)).toMatchObject({
    status: "available",
    vehicle: { year: 2020, color: null, stockNumber: null, engine: null },
  });
});

test.each([
  ["2008 BMW 535XI", "2008", "BMW", "35XI"],
  ["2023 BMW X5 M50I", "2023", "BMW", "X5 M50l"],
  ["2023 BMW X3 M40i", "2023", "BMW", "X3 M40l"],
  ["2013 BMW 320I", "2013", "BMW", "320l"],
])(
  "City Motors rejects actual native model conflict %s without repair",
  (heading, year, make, model) => {
    const record = parseCitymotorsDetail(
      citymotorsFixtureDetail({ heading, year, make, model }),
      { ...citymotorsFixturePost, title: heading },
    );
    expect(transformCitymotorsRecord(record)).toEqual({
      status: "incomplete",
      vins: ["5UXCW2C09L9B00683"],
    });
  },
);

test.each([
  ["2021 Mercedes-Maybach GLS 600", "Mercedes-Benz", "Maybach GLS 600"],
  [
    "2021 Mercedes-AMG GLE 63 S 4MATIC+",
    "Mercedes-Benz",
    "AMG GLE 63 S 4MATIC+",
  ],
  ["2021 Mercedes GLC 300", "M-Benz", "GLC 300"],
  ["2021 MB GLS450", "MERCEDES-BENZ", "GLS450"],
  ["2021 BMW M8 COMPETITION", "BMW", "M8 COMP"],
  ["2021 BMW 330i xDrive", "BMW", "330i"],
  ["2021 BMW X7 40I XDRIVE", "BMW", "X7 40I"],
  ["2021 Audi A6 S-Line", "AUDI", "A6"],
  ["2021 Corvette", "Chevrolette", "Corvette"],
  ["2021 Ferrari Portofino", "Ferrary", "Portofino"],
  ["2021 MINI Cooper S Hardtop", "MINI Cooper", "S Hardtop"],
  ["2021 Rolls-Royce Dawn", "ROLLS ROYCE", "DAWN"],
])(
  "City Motors accepts reviewed display wording %s while preserving primary values",
  (heading, make, model) => {
    const record = parseCitymotorsDetail(
      citymotorsFixtureDetail({ heading, year: "2021", make, model }),
      { ...citymotorsFixturePost, title: heading },
    );
    expect(transformCitymotorsRecord(record)).toMatchObject({
      status: "available",
      vehicle: { year: 2021, make, model },
    });
  },
);

test("City Motors retains every valid contradictory VIN and does not repair malformed VINs", () => {
  const record = parseCitymotorsDetail(
    citymotorsFixtureDetail({
      extraFields: "<tr><td>VIN:</td><td>5UXTY9C05LLE59468</td></tr>",
    }),
    citymotorsFixturePost,
  );
  expect(citymotorsRecordVins(record)).toEqual([
    "5UXCW2C09L9B00683",
    "5UXTY9C05LLE59468",
  ]);
  expect(transformCitymotorsRecord(record).status).toBe("incomplete");
  for (const vin of ["5UXCW2CO9L9B00683", "5UXCW2C09L9B0068", "-"]) {
    expect(
      transformCitymotorsRecord(
        parseCitymotorsDetail(
          citymotorsFixtureDetail({ vin }),
          citymotorsFixturePost,
        ),
      ),
    ).toEqual({ status: "incomplete", vins: [] });
  }
});

test("City Motors counts distinct equal-title destinations and follows literal pagination", () => {
  const posts = Array.from({ length: 32 }, (_, index) => ({
    ...citymotorsFixturePost,
    url: citymotorsFixturePost.url.replace(/\/$/, `-${index}/`),
  }));
  const catalog = parseCitymotorsCatalog(
    citymotorsFixtureCatalog(posts, 1, 2),
    CITYMOTORS_CATALOG,
  );
  expect(catalog.posts).toHaveLength(32);
  expect(catalog.next).toBe(CITYMOTORS_CATALOG + "?page-number=2");
  expect(() =>
    parseCitymotorsCatalog(
      citymotorsFixtureCatalog(posts.slice(1), 1, 2),
      CITYMOTORS_CATALOG,
    ),
  ).toThrow("pagination");
  expect(() =>
    parseCitymotorsCatalog(
      citymotorsFixtureCatalog([citymotorsFixturePost, citymotorsFixturePost]),
      CITYMOTORS_CATALOG,
    ),
  ).toThrow("repeats");
  expect(() =>
    parseCitymotorsCatalog(
      citymotorsFixtureCatalog().replaceAll(
        citymotorsFixturePost.url,
        "https://example.com/cars/vehicle/",
      ),
      CITYMOTORS_CATALOG,
    ),
  ).toThrow();
});

test("City Motors requires complete native ownership, canonical and active donor scope", () => {
  const raw = citymotorsFixtureDetail();
  expect(
    transformCitymotorsRecord(
      parseCitymotorsDetail(
        citymotorsFixtureDetail({ status: "" }),
        citymotorsFixturePost,
      ),
    ).status,
  ).toBe("available");
  for (const body of [
    raw.replace("2150 West St", "2151 West St"),
    raw.replace('"41.9274"', '"41.9"'),
    raw.replace('rel="canonical"', 'rel="alternate"'),
    raw.replace("Available</p>", "Sold whole</p>"),
    raw.replace(
      "We are dismantling it.",
      "This vehicle is no longer available.",
    ),
    raw.slice(0, -20),
    raw.replace("</table>", ""),
  ]) {
    expect(() => parseCitymotorsDetail(body, citymotorsFixturePost)).toThrow();
  }
});

test("City Motors deduplicates compatible identities with nullable optional conflicts", () => {
  const record = parseCitymotorsDetail(
    citymotorsFixtureDetail(),
    citymotorsFixturePost,
  );
  const duplicate = {
    ...record,
    post: {
      ...record.post,
      url: record.post.url.replace(/\/$/, "-2/"),
      imageUrl: null,
    },
  };
  const result = citymotorsSnapshot([record, duplicate]);
  expect(result.vehicles).toHaveLength(1);
  expect(result.vehicles[0]?.imageUrl).toBeNull();
  expect(result.accounting).toEqual({
    recordsProcessed: 2,
    recordsRejected: 0,
    recordsExcluded: 0,
    duplicateVehicles: 1,
  });
  expect(() => validateCitymotorsSnapshot(result)).toThrow("25%");
  const conflict = parseCitymotorsDetail(
    citymotorsFixtureDetail({ heading: "2020 BMW X5", model: "X5" }),
    { ...citymotorsFixturePost, title: "2020 BMW X5" },
  );
  expect(() => citymotorsSnapshot([record, conflict])).toThrow(
    "conflicting required YMM",
  );
});

test("City Motors malformed optional photo attributes do not reject donor identity", () => {
  const raw = citymotorsFixtureCatalog().replace(
    "<img data-full-src=",
    '<img data-full-src="https://example.com/placeholder.jpg" data-full-src=',
  );
  expect(parseCitymotorsCatalog(raw, CITYMOTORS_CATALOG).posts).toEqual([
    { ...citymotorsFixturePost, imageUrl: null },
  ]);
});

test("City Motors inspects every direct primary status paragraph", () => {
  const raw = citymotorsFixtureDetail();
  const opening = '<div class="right-product-description">';
  expect(() =>
    parseCitymotorsDetail(
      raw.replace(opening, opening + "<div></div><p>Sold whole</p>"),
      citymotorsFixturePost,
    ),
  ).toThrow("active own-yard scope");
  expect(() =>
    parseCitymotorsDetail(
      raw.replace("<p>Available</p>", "<p>Available</p><p>Sold whole</p>"),
      citymotorsFixturePost,
    ),
  ).toThrow("active own-yard scope");
  expect(
    parseCitymotorsDetail(
      raw.replace(opening, opening + "<div></div>"),
      citymotorsFixturePost,
    ).status,
  ).toBe("Available");
});
