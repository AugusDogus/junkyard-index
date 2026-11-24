import { expect, test } from "bun:test";
import robots from "./robots";
import { searchPageMetadata } from "./search/search-metadata";
import sitemap from "./sitemap";

test("crawlers may fetch parameterized /search to see its noindex", () => {
  const rules = [robots().rules].flat();
  const disallowed = rules.flatMap((rule) => [rule.disallow ?? []].flat());
  expect(disallowed.some((path) => path.startsWith("/search"))).toBe(false);
});

test("the sitemap lists landing pages but not /search", () => {
  const paths = sitemap().map((entry) => new URL(entry.url).pathname);
  expect(paths).not.toContain("/search");
  expect(paths).toEqual(expect.arrayContaining(["/junkyards", "/cars"]));
});

test("bare /search stays indexable", () => {
  const metadata = searchPageMetadata({});
  expect(metadata.robots).toBeUndefined();
  expect(metadata.alternates?.canonical).toBe("/search");
  expect(metadata.openGraph).toMatchObject({ url: "/search" });
});

test("robots.txt lists the hub sitemaps, then the yard-make sitemap", () => {
  expect(
    [robots().sitemap ?? []].flat().map((url) => new URL(url).pathname),
  ).toEqual([
    "/sitemap.xml",
    "/junkyards/sitemap.xml",
    "/chains/sitemap.xml",
    "/cars/sitemap.xml",
    "/junkyards/sitemap-makes.xml",
  ]);
});

test.each([
  { q: "Toyota Venza" },
  { "makes[]": ["Toyota"] },
  { utm_source: "x" },
])(
  "parameterized /search %p is noindex, follow, with the canonical /search",
  (params) => {
    const metadata = searchPageMetadata(params);
    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(metadata.alternates?.canonical).toBe("/search");
  },
);
