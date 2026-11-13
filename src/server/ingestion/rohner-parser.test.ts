import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { rohnerFixture, rohnerNativeFixtures } from "./rohner-test-fixtures";
import { parseRohnerArticle } from "./rohner-parser";
import {
  parseRohnerCatalog,
  RohnerCatalogSchema,
  rohnerCatalogMembership,
  rohnerCatalogPage,
} from "./rohner-parser";
import { extractRohnerArticle } from "./rohner-html";
import { acceptRohnerArticle } from "./rohner-parser";
import { isRohnerArticleUrl, RohnerArticleResultSchema } from "./rohner-record";

test("Rohner preserves the native Town & Country identity across structured entities", () => {
  const fixture = rohnerFixture("aa0268");
  const result = parseRohnerArticle(fixture.html, fixture.url, fixture.cards);
  expect(result.status).toBe("required-pass");
  expect(result.candidate).toEqual(fixture.expected.candidate);
  expect(result.validVinClaims).toEqual(["2A4GP54L46R688069"]);
});

test.each(rohnerNativeFixtures().catalogs)(
  "Rohner reads exact native ranges and filtered continuations for $url",
  (fixture) => {
    const catalog = parseRohnerCatalog(fixture.html, fixture.url);
    expect(catalog.page).toBe(fixture.expected.page);
    expect(catalog.range).toEqual(fixture.expected.range);
    expect(catalog.posts).toHaveLength(fixture.expected.cards);
    expect(catalog.links).toEqual(fixture.expected.pagination);
    expect(catalog.lastPage).toBe(12);
    expect(
      catalog.posts.every((post) =>
        post.card.classes.some((value) => /^post-\d+$/.test(value)),
      ),
    ).toBe(true);
    expect(
      RohnerCatalogSchema.safeParse({ ...catalog, hash: "0".repeat(64) })
        .success,
    ).toBe(false);
    expect(rohnerCatalogMembership(catalog).posts[0]?.card).not.toHaveProperty(
      "imageOccurrences",
    );
  },
);

test.each([
  "https://rohnersautoparts.com/shop/../",
  "https://rohnersautoparts.com/shop/%2e%2e/",
  "https://rohnersautoparts.com/shop/aa0001%2fother/",
  "https://rohnersautoparts.com/shop/aa0001\\other/",
  "https://rohnersautoparts.com/shop/aa0001/?x=1",
  "https://other.example/shop/aa0001/",
])("Rohner rejects nonliteral native article destinations: %s", (url) => {
  expect(isRohnerArticleUrl(url)).toBe(false);
});

test("Rohner keeps the generic WordPress canonical outside the filtered traversal", () => {
  expect(rohnerCatalogPage("https://rohnersautoparts.com/shop/")).toBeNull();
  expect(
    rohnerCatalogPage(
      "https://rohnersautoparts.com/shop/?product-categories=vehicles",
    ),
  ).toBe(1);
  expect(
    rohnerCatalogPage(
      "https://rohnersautoparts.com/shop/page/12/?product-categories=vehicles",
    ),
  ).toBe(12);
});

test.each([
  "https://rohnersautoparts.com/shop/page/2/../3/?product-categories=vehicles",
  "https://ROHNERSAUTOPARTS.COM/shop/?product-categories=vehicles",
  "https://rohnersautoparts.com/shop/page/%32/?product-categories=vehicles",
  "https://rohnersautoparts.com/shop/?product-categories=parts",
])(
  "Rohner rejects catalog normalization aliases and changed native filters: %s",
  (url) => {
    expect(rohnerCatalogPage(url)).toBeNull();
  },
);

test("Rohner rejects truncated catalogs, inconsistent counts and unbound pagination", () => {
  const fixture = rohnerNativeFixtures().catalogs[0];
  if (!fixture) throw new Error("Missing first native catalog fixture");
  for (const html of [
    fixture.html.replace("</html>", ""),
    fixture.html.replace("1&ndash;24 of 287", "1&ndash;23 of 287"),
    fixture.html.replaceAll(
      "product-categories=vehicles",
      "product-categories=parts",
    ),
  ]) {
    expect(html !== fixture.html).toBe(true);
    expect(() => parseRohnerCatalog(html, fixture.url)).toThrow();
  }
});

test("Rohner malformed structured data remains a boundary rejection with native VIN presence", () => {
  const fixture = rohnerFixture("aa0304");
  const html = fixture.html.replace(
    /(<script\b[^>]*type="application\/ld\+json"[^>]*>)/,
    "$1{",
  );
  expect(html !== fixture.html).toBe(true);
  const result = parseRohnerArticle(html, fixture.url, fixture.cards);
  expect(result.status).toBe("boundary-unknown");
  expect(result.validVinClaims).toEqual(["ML32A4HJ3FH039866"]);
});

test.each([
  ["<title>2015", "<title>2016"],
  [
    "2015 Mitsubishi Mirage ES (AA0304) Part Out</h1>",
    "2016 Mitsubishi Mirage ES (AA0304) Part Out</h1>",
  ],
  ['data-thumb-alt="2015', 'data-thumb-alt="2016'],
  ['"name":"2015', '"name":"2016'],
])("Rohner retains conflicting native identity claim %s", (before, after) => {
  const fixture = rohnerFixture("aa0304");
  expect(fixture.html).toContain(before);
  const result = parseRohnerArticle(
    fixture.html.replace(before, after),
    fixture.url,
    fixture.cards,
  );
  expect(result.status).toBe("identity-conflict");
  expect(result.candidate).toBeNull();
  expect(result.validVinClaims).toEqual(["ML32A4HJ3FH039866"]);
});

test("Rohner retains conflicting Open Graph destinations and valid VIN presence", () => {
  const fixture = rohnerFixture("aa0304");
  const tag = fixture.html.match(/<meta\b[^>]*property="og:url"[^>]*>/)?.[0];
  if (!tag) throw new Error("Native Open Graph fixture is missing");
  const html = fixture.html.replace(
    tag,
    tag.replace(fixture.url, "https://rohnersautoparts.com/shop/other/"),
  );
  const result = parseRohnerArticle(html, fixture.url, fixture.cards);
  expect(result.status).toBe("identity-conflict");
  expect(result.claimedDestinations).toContain(
    "https://rohnersautoparts.com/shop/other/",
  );
  expect(result.validVinClaims).toEqual(["ML32A4HJ3FH039866"]);
});

test("Rohner required fields remain independent of optional photos, stock and Part Out labels", () => {
  const fixture = rohnerFixture("aa0304");
  const html = fixture.html
    .replace(/<img\b[^>]*>/g, "")
    .replaceAll("(AA0304)", "")
    .replace(/<span class="sku">AA0304<\/span>/, "")
    .replaceAll(" Part Out", "");
  const cards = fixture.cards.map((card) => ({
    ...card,
    titles: card.titles.map((title) =>
      title.replaceAll("(AA0304)", "").replaceAll(" Part Out", ""),
    ),
    imageOccurrences: [],
  }));
  const result = parseRohnerArticle(html, fixture.url, cards);
  expect(result.status).toBe("required-pass");
  expect(result.candidate?.stockNumber).toBeNull();
  expect(result.candidate?.imageUrl).toBeNull();
  expect(result.candidate?.availableDate).toBeNull();
});

test("Rohner rejects placeholder models without losing a separately valid VIN", () => {
  const fixture = rohnerFixture("aa0304");
  const raw = extractRohnerArticle(fixture.html, fixture.url);
  const changed = {
    ...raw,
    summaries: raw.summaries.map((summary) => ({
      ...summary,
      fields: summary.fields.map((field) =>
        field.label === "Model" ? { ...field, value: "N.A." } : field,
      ),
    })),
  };
  const result = acceptRohnerArticle(changed, fixture.cards);
  expect(result.status).toBe("required-reject");
  expect(result.validVinClaims).toEqual(["ML32A4HJ3FH039866"]);
});

test("Rohner cursor records cannot replace canonical required identity while retaining native evidence", () => {
  const fixture = rohnerFixture("aa0304");
  const result = parseRohnerArticle(fixture.html, fixture.url, fixture.cards);
  expect(RohnerArticleResultSchema.safeParse(result).success).toBe(true);
  if (result.status !== "required-pass")
    throw new Error("Expected native passing fixture");
  for (const candidate of [
    { ...result.candidate, vin: "1G1RA6E47DU114541" },
    { ...result.candidate, year: 2016 },
    { ...result.candidate, make: "Ford" },
    { ...result.candidate, model: "Focus" },
    {
      ...result.candidate,
      detailsUrl: "https://rohnersautoparts.com/shop/other/",
    },
  ])
    expect(
      RohnerArticleResultSchema.safeParse({ ...result, candidate }).success,
    ).toBe(false);
  expect(
    RohnerArticleResultSchema.safeParse({ ...result, validVinClaims: [] })
      .success,
  ).toBe(false);
});

test.each(rohnerNativeFixtures().articles)(
  "Rohner matches the independent native identity oracle for $stock",
  (fixture) => {
    expect(createHash("sha256").update(fixture.html).digest("hex")).toBe(
      fixture.source.sha256,
    );
    const result = parseRohnerArticle(fixture.html, fixture.url, fixture.cards);
    expect(result.status).toBe(fixture.expected.status);
    expect(result.candidate).toEqual(fixture.expected.candidate);
    expect(result.validVinClaims).toEqual(fixture.expected.validVinClaims);
    expect(result.claimedDestinations).toEqual(
      fixture.expected.claimedDestinations,
    );
    expect(result.scopeObservations).toEqual(
      fixture.expected.scopeObservations,
    );
    expect(result.imageEvidenceIssues).toEqual(
      fixture.expected.imageEvidenceIssues,
    );
  },
);
