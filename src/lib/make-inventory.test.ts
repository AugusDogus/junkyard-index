import { describe, expect, test } from "bun:test";
import { MakeInventory, type MakeRollupRow } from "./make-inventory";

describe("MakeInventory.makes", () => {
  test("merges spellings and aliases and drops placeholders", () => {
    const makes = MakeInventory.makes([
      { make: "Volkswagen", count: 30 },
      { make: "Vw", count: 10 },
      { make: "Honda", count: 50 },
      { make: "Other", count: 99 },
    ]);
    expect(makes).toEqual([
      {
        key: "HONDA",
        name: "Honda",
        slug: "honda",
        href: "/cars/honda",
        rawMakes: ["Honda"],
        count: 50,
      },
      {
        key: "VOLKSWAGEN",
        name: "Volkswagen",
        slug: "volkswagen",
        href: "/cars/volkswagen",
        rawMakes: ["Volkswagen", "Vw"],
        count: 40,
      },
    ]);
  });
});

describe("MakeInventory.models", () => {
  const [bmw] = MakeInventory.makes([{ make: "BMW", count: 10 }]);
  if (!bmw) throw new Error("expected BMW");
  const row = (overrides: Partial<MakeRollupRow>): MakeRollupRow => ({
    source: "pyp",
    code: "1",
    make: "BMW",
    model: "3 Series",
    count: 1,
    minYear: 2005,
    maxYear: 2005,
    ...overrides,
  });

  test("groups spellings per model and sums each yard", () => {
    const [model] = MakeInventory.models(bmw, [
      row({ model: "3 SERIES", count: 4, minYear: 1999, maxYear: 2004 }),
      row({ model: "3-Series", count: 2, minYear: 2008, maxYear: 2011 }),
      row({ code: "2", model: "3 Series", count: 7 }),
    ]);
    expect(model).toMatchObject({
      key: "3SERIES",
      name: "3 Series",
      slug: "3-series",
      href: "/cars/bmw/3-series",
      count: 13,
      minYear: 1999,
      maxYear: 2011,
      rawModels: ["3 SERIES", "3 Series", "3-Series"],
    });
    expect(model?.yards).toEqual([
      { source: "pyp", code: "2", count: 7, minYear: 2005, maxYear: 2005 },
      { source: "pyp", code: "1", count: 6, minYear: 1999, maxYear: 2011 },
    ]);
  });

  test("only models with enough vehicles are indexable", () => {
    expect(MakeInventory.indexable({ count: 19 })).toBe(false);
    expect(MakeInventory.indexable({ count: 20 })).toBe(true);
  });
});

test("unambiguous aliases use canonical make names and retain raw query spellings", () => {
  const makes = MakeInventory.makes([
    { make: "Ferrary", count: 2 },
    { make: "Ferrari", count: 1 },
    { make: "Chevy", count: 1 },
  ]);
  expect(makes[0]).toMatchObject({
    key: "FERRARI",
    name: "Ferrari",
    slug: "ferrari",
    rawMakes: ["Ferrari", "Ferrary"],
    count: 3,
  });
  expect(makes[1]).toMatchObject({
    key: "CHEVROLET",
    name: "Chevrolet",
    slug: "chevrolet",
    rawMakes: ["Chevy"],
  });
});

test("ambiguous provider models stay noindex regardless of inventory count", () => {
  const [make] = MakeInventory.makes([{ make: "Toyota", count: 23 }]);
  if (!make) throw new Error("Missing Toyota");
  const [model] = MakeInventory.models(make, [
    {
      source: "pyp",
      code: "1",
      make: "Toyota",
      model: "Toyota Ttoyota",
      count: 23,
      minYear: 2000,
      maxYear: 2004,
    },
  ]);
  if (!model) throw new Error("Missing ambiguous label");
  expect(model.name).toBe("Ttoyota");
  expect(MakeInventory.indexable(model)).toBe(false);
  expect([model].filter((entry) => MakeInventory.indexable(entry))).toEqual([]);
});
