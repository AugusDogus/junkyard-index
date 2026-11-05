import { describe, expect, test } from "bun:test";
import { Region } from "./region";
import { Slug } from "./slug";
import { YardPath } from "./yard-path";

const yard = (
  overrides: Partial<{
    source: string;
    code: string;
    name: string;
    city: string;
    state: string;
  }>,
) => ({
  source: "pyp",
  code: "1",
  name: "Pick Your Part - Sun Valley",
  city: "Sun Valley",
  state: "CA",
  ...overrides,
});

describe("Slug.from", () => {
  test("keeps words and drops punctuation", () => {
    expect(Slug.from("Paul's - Lake Station")).toBe("pauls-lake-station");
    expect(Slug.from("U-Pull-&-Pay - Denver")).toBe("u-pull-and-pay-denver");
    expect(Slug.from("PICK-n-PULL St. Louis")).toBe("pick-n-pull-st-louis");
    expect(Slug.from("Café Autos")).toBe("cafe-autos");
  });
});

describe("Region", () => {
  test("resolves states and provinces both ways", () => {
    expect(Region.fromAbbr("ca")?.slug).toBe("california");
    expect(Region.fromAbbr("AB")).toMatchObject({
      name: "Alberta",
      country: "CA",
    });
    expect(Region.fromSlug("new-mexico")?.abbr).toBe("NM");
    expect(Region.fromAbbr("ZZ")).toBeNull();
    expect(Region.fromSlug("California")).toBeNull();
  });
});

describe("YardPath.assign", () => {
  test("builds paths from the region and yard name", () => {
    const paths = YardPath.assign([yard({})]);
    expect(paths.get("pyp:1")).toMatchObject({
      slug: "pick-your-part-sun-valley",
      href: "/junkyards/california/pick-your-part-sun-valley",
    });
  });

  test("adds the city unless the name already says it", () => {
    const paths = YardPath.assign([
      yard({ code: "1", name: "Foss", city: "Wilson", state: "NC" }),
      yard({ code: "2", name: "Foss Havelock", city: "Havelock", state: "NC" }),
      yard({
        code: "3",
        name: "Pull-A-Part - Atlanta South",
        city: "Conley",
        state: "GA",
      }),
      yard({
        code: "4",
        name: "PICK-n-PULL St. Louis",
        city: "St. Louis",
        state: "MO",
      }),
    ]);
    expect(paths.get("pyp:1")?.slug).toBe("foss-wilson");
    expect(paths.get("pyp:2")?.slug).toBe("foss-havelock");
    expect(paths.get("pyp:3")?.slug).toBe("pull-a-part-atlanta-south-conley");
    expect(paths.get("pyp:4")?.slug).toBe("pick-n-pull-st-louis");
  });

  test("a new yard never changes an existing yard's path", () => {
    const existing = yard({
      code: "1",
      name: "Foss",
      city: "Wilson",
      state: "NC",
    });
    const before = YardPath.assign([existing]).get("pyp:1")?.href;
    const after = YardPath.assign([
      existing,
      yard({ code: "2", name: "Foss", city: "Havelock", state: "NC" }),
    ]).get("pyp:1")?.href;
    expect(after).toBe(before);
  });

  test("names that spell another yard's name and city stay distinct", () => {
    const paths = YardPath.assign([
      yard({ code: "1", name: "Foss", city: "Wilson", state: "NC" }),
      yard({ code: "2", name: "Foss Wilson", city: "Wilson", state: "NC" }),
    ]);
    const hrefs = [...paths.values()].map((path) => path.href);
    expect(new Set(hrefs).size).toBe(2);
    for (const href of hrefs) {
      expect(href).toMatch(
        /^\/junkyards\/north-carolina\/foss-wilson-[0-9a-z]{6}$/,
      );
    }
  });

  test("falls back to a stable hash when name and city both collide", () => {
    const input = [
      yard({ source: "pyp", code: "1" }),
      yard({ source: "row52", code: "1" }),
    ];
    const first = YardPath.assign(input);
    const second = YardPath.assign([...input].reverse());
    const pyp = first.get("pyp:1")?.slug;
    const row52 = first.get("row52:1")?.slug;
    expect(pyp).toMatch(/^pick-your-part-sun-valley-[0-9a-z]{6}$/);
    expect(row52).toMatch(/^pick-your-part-sun-valley-[0-9a-z]{6}$/);
    expect(pyp).not.toBe(row52);
    expect(second.get("pyp:1")?.slug).toBe(pyp);
  });

  test("skips yards outside known regions", () => {
    expect(YardPath.assign([yard({ state: "??" })]).size).toBe(0);
  });

  test("pages after the first live under /page/{n}", () => {
    const path = YardPath.assign([yard({})]).get("pyp:1");
    if (!path) throw new Error("expected a path");
    expect(YardPath.pageHref(path, 1)).toBe(path.href);
    expect(YardPath.pageHref(path, 3)).toBe(`${path.href}/page/3`);
  });
});
