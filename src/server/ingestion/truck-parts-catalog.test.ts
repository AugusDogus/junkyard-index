import { expect, test } from "bun:test";
import { parseTruckPartsCatalogPage } from "./truck-parts-catalog";

const white = {
  origin: "https://white-bradstreet.com",
  listPath: "/trucks/",
  detailPath: "/truck-description/",
  photoAccount: "28272",
};
const river = {
  origin: "https://rivervalleytruckparts.com",
  listPath: "/new-arrivals/",
  detailPath: "/truck-description/",
  photoAccount: "24174",
};

function card(id = "193589", make = "Peterbilt") {
  const detail = `/truck-description?truck=${id}`;
  const field = (name: string, value: string) =>
    `<div class="label"><h6>${name} :</h6></div><div class="value"><p>${value}</p></div>`;
  return `<div class="list-item "><div class="header-list-item"><a href=" ${detail}"><h2>2010 Peterbilt 386</h2></a></div>
    <div class="body-list-item"><a href="${detail}"><img src="loading.svg" data-src="https://images.truckpartsinventory.com/trucks/28272/donor.webp"></a>
    ${field("Truck Make", make)}${field("Truck Model", "386")}${field("Vin Number", "1XPHD49X0AD113809")}${field("Lot Number", "471B")}${field("Condition", "Salvage")}
    <a href="${detail}">Click for full truck details</a></div></div>`;
}

function page(cards = card(), total = 1, next = "") {
  const pagination = `<ul class="pagination"><li><span class="pagination-info">1-${Math.min(total, 25)} of ${total}</span></li><li class="active"><a href="#">1</a></li>${next}</ul>`;
  return `<html><body><div class="filter-title">Current Filters</div><div class="filter-list"><div>Condition: Salvage <a href="/trucks/?">×</a></div></div><div class="well"><div class="filter-title">Truck Make</div><div class="filter-list" id="makeFilter"><a href="?f-make=1">Peterbilt 1</a></div></div>
    ${pagination}${cards}${pagination}</body></html>`;
}

test("reads the two proven TPI donor templates and canonical native destinations", () => {
  const result = parseTruckPartsCatalogPage(page(), 1, white);
  expect(result).toMatchObject({
    page: 1,
    rangeStart: 1,
    rangeEnd: 1,
    total: 1,
    lastPage: 1,
    nextUrl: null,
    records: [
      {
        id: "193589",
        year: "2010",
        make: "Peterbilt",
        model: "386",
        vin: "1XPHD49X0AD113809",
        condition: "Salvage",
        stockNumber: "471B",
        imageUrl:
          "https://images.truckpartsinventory.com/trucks/28272/donor.webp",
        detailsUrl:
          "https://white-bradstreet.com/truck-description/?truck=193589",
        engine: null,
      },
    ],
  });
  expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
  const rv = parseTruckPartsCatalogPage(
    page().replaceAll("28272", "24174"),
    1,
    river,
  );
  expect(rv.records[0]?.detailsUrl).toBe(
    "https://rivervalleytruckparts.com/truck-description/?truck=193589",
  );
});

test("rejects additional active filters while preserving unselected sidebar options", () => {
  const raw = page();
  expect(parseTruckPartsCatalogPage(raw, 1, white).total).toBe(1);
  const filtered = raw.replace(
    '<div class="well">',
    '<div class="filter-list"><div>Truck Make: Peterbilt <a href="?f-make=1">×</a></div></div><div class="well">',
  );
  expect(() => parseTruckPartsCatalogPage(filtered, 1, white)).toThrow(
    "current",
  );
});

test("preserves missing required metadata and raw invalid identity for explicit rejection", () => {
  const html = page(card("193589", "")).replaceAll(
    "1XPHD49X0AD113809",
    "4v4nc9tko7n458072",
  );
  expect(parseTruckPartsCatalogPage(html, 1, white).records[0]).toMatchObject({
    make: "",
    vin: "4v4nc9tko7n458072",
  });
});

test("native price headings cannot swallow the first nested Truck Make field", () => {
  const native = card().replace(
    "</h2></a></div>",
    "</h2></a><div class='price'><h6>To be quoted</h6></div></div>",
  );
  expect(
    parseTruckPartsCatalogPage(page(native), 1, white).records[0],
  ).toMatchObject({
    make: "Peterbilt",
    model: "386",
    vin: "1XPHD49X0AD113809",
    stockNumber: "471B",
  });
});

test("checks the pagination selection independently of active site navigation", () => {
  const html = page().replace(
    "<body>",
    '<body><ul class="menu"><li class="active">Trucks</li></ul>',
  );
  expect(parseTruckPartsCatalogPage(html, 1, river).page).toBe(1);
});

test.each([
  ["truncated document", (html: string) => html.replace("</html>", "")],
  ["broken card", (html: string) => html.replace("</div></div>", "</div>")],
  ["count mismatch", (html: string) => html.replaceAll("1-1 of 1", "1-2 of 2")],
  [
    "inconsistent pagination",
    (html: string) => html.replace("1-1 of 1", "1-1 of 2"),
  ],
  [
    "retail scope",
    (html: string) => html.replace("Condition: Salvage", "Condition: Complete"),
  ],
  [
    "retail donor",
    (html: string) => html.replace("<p>Salvage</p>", "<p>Complete</p>"),
  ],
  [
    "foreign detail",
    (html: string) =>
      html.replace(
        'href=" /truck-description?',
        'href="https://example.com/truck-description?',
      ),
  ],
  [
    "conflicting donor link",
    (html: string) => html.replace("truck=193589", "truck=193590"),
  ],
] as const)("blocks %s", (_label, change) => {
  expect(() => parseTruckPartsCatalogPage(change(page()), 1, white)).toThrow();
});

test("validates source-published page transitions instead of synthesizing pagination", () => {
  const rows = Array.from({ length: 25 }, (_, i) =>
    card(String(193589 + i)),
  ).join("");
  const next =
    '<li><a href="https://white-bradstreet.com/trucks/?f-condition=nw&amp;page_number=2">Next Page</a></li>';
  const html = page(rows, 26, next);
  expect(parseTruckPartsCatalogPage(html, 1, white).nextUrl).toBe(
    "https://white-bradstreet.com/trucks/?f-condition=nw&page_number=2",
  );
  for (const changed of [
    html.replaceAll("page_number=2", "page_number=3"),
    html.replaceAll("f-condition=nw", "f-condition=c"),
    html.replaceAll(next, ""),
  ]) {
    expect(() => parseTruckPartsCatalogPage(changed, 1, white)).toThrow();
  }
});

test("ignores volatile scripts in evidence hashes and never uses a placeholder or another tenant photo", () => {
  const raw = page();
  const parsed = parseTruckPartsCatalogPage(raw, 1, white);
  expect(
    parseTruckPartsCatalogPage(
      raw.replace("<body>", '<body><script>const token="changed";</script>'),
      1,
      white,
    ).hash,
  ).toBe(parsed.hash);
  expect(
    parseTruckPartsCatalogPage(
      raw.replace("/trucks/28272/", "/trucks/24174/"),
      1,
      white,
    ).records[0]?.imageUrl,
  ).toBeNull();
});
