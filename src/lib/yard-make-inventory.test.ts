import { expect, test } from "bun:test";
import { MakeInventory, type MakeRollupRow } from "./make-inventory";
import { YardMakeInventory } from "./yard-make-inventory";
import { YardSitemap } from "./yard-sitemap";
import { Region } from "./region";

test("yard-make sitemap counts every raw model and only includes routed yards", () => {
  const [make] = MakeInventory.makes([{ make: "Honda", count: 29 }]);
  const region = Region.fromAbbr("PA");
  if (!make || !region) throw new Error("Missing fixture");
  const row = (code: string, model: string, count: number): MakeRollupRow => ({
    source: "pyp",
    code,
    make: "Honda",
    model,
    count,
    minYear: 2000,
    maxYear: 2005,
  });
  const pages = YardMakeInventory.indexable(make, [
    row("1", "Civic", 3),
    row("1", "Honda", 2),
    row("2", "Accord", 4),
    row("3", "Civic", 20),
  ]);
  expect(pages).toEqual([
    { source: "pyp", code: "1", slug: "honda", count: 5 },
    { source: "pyp", code: "3", slug: "honda", count: 20 },
  ]);
  const yard = {
    source: "pyp",
    code: "1",
    path: { region, slug: "yard", href: "/junkyards/pennsylvania/yard" },
  };
  const other = {
    ...yard,
    code: "2",
    path: {
      ...yard.path,
      slug: "other",
      href: "/junkyards/pennsylvania/other",
    },
  };
  const publications = {
    "pyp:1": "2026-10-01",
    "pyp:2": "2026-11-01",
    "upullitne:1": "2026-11-18",
  };
  const hubs = YardSitemap.hubs(
    "https://example.com",
    [yard, other],
    publications,
  );
  const makes = YardSitemap.makes(
    "https://example.com",
    [yard, other],
    publications,
    pages,
  );
  // Hubs and yard-make pages live in separate sitemaps.
  expect(hubs.some((entry) => entry.url.includes("/make/"))).toBe(false);
  expect(makes.every((entry) => entry.url.includes("/make/"))).toBe(true);
  const entries = [...hubs, ...makes];
  expect(
    entries.find((entry) => entry.url.endsWith("/yard/make/honda"))
      ?.lastModified,
  ).toBe("2026-10-01");
  expect(
    entries.find((entry) => entry.url.endsWith("/yard"))?.lastModified,
  ).toBe("2026-10-01");
  expect(
    entries.find((entry) => entry.url.endsWith("/pennsylvania"))?.lastModified,
  ).toBe("2026-11-01");
  expect(
    entries.some(
      (entry) => entry.url.includes("/other/make") || entry.url.includes("/3/"),
    ),
  ).toBe(false);
});

test("sitemap omits unknown publication dates and retains known dates even when stale", () => {
  const region = Region.fromAbbr("PA");
  if (!region) throw new Error("Expected fixture region");
  const yard = {
    source: "pyp",
    code: "1",
    path: { region, slug: "yard", href: "/junkyards/pennsylvania/yard" },
  };
  const makes = [{ source: "pyp", code: "1", slug: "honda", count: 5 }];
  const entries = (publications: Readonly<Record<string, string>>) => [
    ...YardSitemap.hubs("https://example.com", [yard], publications),
    ...YardSitemap.makes("https://example.com", [yard], publications, makes),
  ];
  const before = entries({});
  expect(before).toHaveLength(3);
  expect(before.every((entry) => !("lastModified" in entry))).toBe(true);

  const publishedAt = "2026-10-01T12:00:00.000Z";
  const after = entries({ "pyp:1": publishedAt });
  expect(after.map((entry) => entry.lastModified)).toEqual([
    publishedAt,
    publishedAt,
    publishedAt,
  ]);
});

test("a chain without a recent source publication dates from its newest yard", () => {
  const yards = [
    { source: "paulsauto", code: "gary" },
    { source: "paulsauto", code: "hammond" },
    { source: "paulsauto", code: "never" },
  ];
  const publications = {
    "paulsauto:gary": "2026-11-21T08:00:00.000Z",
    "paulsauto:hammond": "2026-11-22T08:00:00.000Z",
  };
  expect(YardSitemap.chainLastModified(null, yards, publications)).toBe(
    "2026-11-22T08:00:00.000Z",
  );
  // A source that published inside the freshness window still wins.
  expect(
    YardSitemap.chainLastModified(
      "2026-11-24T08:00:00.000Z",
      yards,
      publications,
    ),
  ).toBe("2026-11-24T08:00:00.000Z");
  expect(YardSitemap.chainLastModified(null, yards, {})).toBeUndefined();
});

test("yard-make sitemap XML escapes URLs and keeps lastmod", () => {
  expect(
    YardSitemap.xml([
      { url: "https://example.com/a?b=1&c=2" },
      {
        url: "https://example.com/d",
        lastModified: "2026-11-01T00:00:00.000Z",
      },
    ]),
  ).toBe(
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      "<url>\n<loc>https://example.com/a?b=1&amp;c=2</loc>\n</url>\n" +
      "<url>\n<loc>https://example.com/d</loc>\n<lastmod>2026-11-01T00:00:00.000Z</lastmod>\n</url>\n" +
      "</urlset>\n",
  );
});
