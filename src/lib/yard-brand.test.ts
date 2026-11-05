import { describe, expect, test } from "bun:test";
import { YardBrand } from "./yard-brand";

const yard = (
  overrides: Partial<{
    source: string;
    operator: string | null;
    name: string;
    city: string;
  }>,
) => ({
  source: "autorecycler",
  operator: null,
  name: "Some Yard",
  city: "Somewhere",
  ...overrides,
});

describe("YardBrand.of", () => {
  test("names single-brand sources and operators", () => {
    expect(
      YardBrand.of(yard({ source: "pyp", name: "Pick Your Part - Ontario" })),
    ).toEqual({ slug: "lkq-pick-your-part", name: "LKQ Pick Your Part" });
    expect(
      YardBrand.of(yard({ source: "row52", name: "PICK-n-PULL Oakland" })),
    ).toEqual({ slug: "pick-n-pull", name: "Pick-n-Pull" });
    expect(
      YardBrand.of(
        yard({ source: "pullapart", operator: "U-Pull-&-Pay", name: "Denver" }),
      )?.slug,
    ).toBe("u-pull-and-pay");
  });

  test("other Row52 yards keep their own name", () => {
    expect(
      YardBrand.of(yard({ source: "row52", name: "Joe's Auto", city: "Tulsa" }))
        ?.name,
    ).toBe("Joe's Auto");
  });

  test("a yard named only for its place has no brand", () => {
    expect(
      YardBrand.of(yard({ name: "Atlanta, GA", city: "Unknown" })),
    ).toBeNull();
  });

  test("independents drop their location from the name", () => {
    expect(
      YardBrand.of(yard({ name: "Paul's - Gary", city: "Gary" }))?.name,
    ).toBe("Paul's");
    expect(
      YardBrand.of(yard({ name: "Foss La Grange", city: "La Grange" }))?.name,
    ).toBe("Foss");
    expect(
      YardBrand.of(yard({ name: "TAS Recycling", city: "Tulsa" }))?.name,
    ).toBe("TAS Recycling");
  });
});

describe("YardBrand.chains", () => {
  test("groups spellings and keeps only real brands with several yards", () => {
    const chains = YardBrand.chains([
      yard({ name: "Paul's - Gary", city: "Gary" }),
      yard({ name: "Paul's - Knox", city: "Knox" }),
      yard({ name: "Pauls - Merrilville", city: "Merrillville" }),
      yard({ name: "TAS Recycling", city: "Tulsa" }),
      yard({ name: "Atlanta, GA", city: "Unknown" }),
      yard({ name: "Atlanta, GA", city: "Unknown" }),
      yard({ source: "pyp", name: "Pick Your Part - Ontario" }),
      yard({ source: "pyp", name: "Pick Your Part - Tampa" }),
    ]);
    expect(
      chains.map(({ slug, name, href, yards }) => [
        slug,
        name,
        href,
        yards.length,
      ]),
    ).toEqual([
      ["pauls", "Paul's", "/chains/pauls", 3],
      [
        "lkq-pick-your-part",
        "LKQ Pick Your Part",
        "/chains/lkq-pick-your-part",
        2,
      ],
    ]);
  });
});
