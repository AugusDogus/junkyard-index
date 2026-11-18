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
  const entries = YardSitemap.entries(
    "https://example.com",
    [yard, other],
    {
      "pyp:1": "2026-10-01",
      "pyp:2": "2026-11-01",
      "upullitne:1": "2026-11-18",
    },
    pages,
  );
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
