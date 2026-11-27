import { expect, test } from "bun:test";
import { Region } from "./region";
import { YardSitemap } from "./yard-sitemap";

test("a dormant yard's page stays in the sitemap, dated from when it stopped showing vehicles", () => {
  const region = Region.fromAbbr("PA");
  if (!region) throw new Error("Expected fixture region");
  expect(
    YardSitemap.dormant("https://example.com", [
      {
        source: "pyp",
        code: "1",
        path: { region, slug: "yard", href: "/junkyards/pennsylvania/yard" },
        dormant: { kind: "emptied", since: "2026-11-01T12:00:00.000Z" },
      },
    ]),
  ).toEqual([
    {
      url: "https://example.com/junkyards/pennsylvania/yard",
      lastModified: "2026-11-01T12:00:00.000Z",
    },
  ]);
});
