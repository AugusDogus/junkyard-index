import { expect, test } from "bun:test";
import { Region } from "./region";
import {
  dormantYardMetadata,
  yardPageMetadata,
  yardMakeMetadata,
} from "./yard-page-metadata";

const region = Region.fromAbbr("PA");
if (!region) throw new Error("Expected Pennsylvania");
const yard = {
  name: "Weber Brothers Auto",
  operator: null,
  city: "Annville",
  state: "PA",
  path: {
    region,
    slug: "weber-brothers-auto-annville",
    href: "/junkyards/pennsylvania/weber-brothers-auto-annville",
  },
};

test("yard pagination descriptions include the displayed page and range", () => {
  const first = yardPageMetadata(yard, 271, "2026-11-01T12:00:00Z", 1);
  const second = yardPageMetadata(yard, 271, "2026-11-01T12:00:00Z", 2);
  const last = yardPageMetadata(yard, 271, null, 3);
  expect(first.description).not.toEqual(second.description);
  expect(second.description).toContain("Page 2, vehicles 101 to 200 of 271");
  expect(last.description).toContain("Page 3, vehicles 201 to 271 of 271");
  expect(second.openGraph?.description).toBe(second.description ?? undefined);
  expect(second.twitter?.description).toBe(second.description ?? undefined);
  expect(second.alternates?.canonical).toBe(`${yard.path.href}/page/2`);
  expect(first.description).toContain("Updated Nov 1, 2026");
  expect(last.description).not.toContain("Updated");
});

test("yard make pages index from five vehicles; yard model pages never index", () => {
  const make = { name: "Honda", slug: "honda" };
  const model = { ...make, model: { name: "Civic", slug: "civic" } };
  expect(yardMakeMetadata(yard, make, 4, null).robots).toEqual({
    index: false,
    follow: true,
  });
  expect(yardMakeMetadata(yard, make, 5, null).robots).toBeUndefined();
  // Next clears the layout's robots and googlebot tags for a page whose
  // metadata has a robots key, even an undefined one.
  expect("robots" in yardMakeMetadata(yard, make, 5, null)).toBe(false);
  // The yard's make page and the national model page cover these queries.
  for (const total of [4, 5, 500]) {
    expect(yardMakeMetadata(yard, model, total, null).robots).toEqual({
      index: false,
      follow: true,
    });
  }
  const metadata = yardMakeMetadata(yard, model, 71, null);
  expect(metadata.title).toContain("Honda Civic");
  expect(metadata.description).toContain("71 Honda Civic vehicles");
  expect(metadata.alternates?.canonical).toBe(
    `${yard.path.href}/make/honda/model/civic`,
  );
  expect(
    yardMakeMetadata(
      yard,
      {
        name: "Toyota",
        slug: "toyota",
        model: { name: "Ttoyota", slug: "ttoyota" },
      },
      71,
      null,
    ).robots,
  ).toEqual({ index: false, follow: true });
});

test("yard make pages after the first name their page and range", () => {
  const make = { name: "Chevrolet", slug: "chevrolet" };
  const first = yardMakeMetadata(yard, make, 271, null, 1);
  const second = yardMakeMetadata(yard, make, 271, null, 2);
  expect(first.alternates?.canonical).toBe(`${yard.path.href}/make/chevrolet`);
  expect(first.title).not.toContain("Page");
  expect(second.alternates?.canonical).toBe(
    `${yard.path.href}/make/chevrolet/page/2`,
  );
  expect(second.title).toContain("Chevrolet at Weber Brothers Auto, Page 2");
  expect(second.description).toContain("Page 2, vehicles 101 to 200 of 271");
  expect(second.openGraph?.url).toBe(`${yard.path.href}/make/chevrolet/page/2`);
});

test("a dormant yard keeps its indexable title and says why it shows no vehicles; its make pages are noindexed", () => {
  const unconfirmed = dormantYardMetadata(
    yard,
    { kind: "unconfirmed", since: "2026-11-01T12:00:00Z" },
    null,
  );
  expect(unconfirmed.title).toBe(yardPageMetadata(yard, 10, null, 1).title);
  expect(unconfirmed.description).toBe(
    "We couldn't confirm the inventory at Weber Brothers Auto in Annville, PA after Nov 1, 2026. Its address, directions and the yards near it.",
  );
  expect(unconfirmed.robots).toBeUndefined();
  expect(unconfirmed.alternates?.canonical).toBe(yard.path.href);

  const emptied = dormantYardMetadata(
    yard,
    { kind: "emptied", since: "2026-11-01T12:00:00Z" },
    { name: "Honda", slug: "honda" },
  );
  expect(emptied.title).toBe(
    yardMakeMetadata(yard, { name: "Honda", slug: "honda" }, 10, null).title,
  );
  expect(emptied.description).toBe(
    "Weber Brothers Auto in Annville, PA has listed no vehicles since Nov 1, 2026. Its address, directions and the yards near it.",
  );
  expect(emptied.robots).toEqual({ index: false, follow: true });
  expect(emptied.alternates?.canonical).toBe(`${yard.path.href}/make/honda`);
});
