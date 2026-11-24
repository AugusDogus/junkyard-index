import { describe, expect, test } from "bun:test";
import { MakeInventory, type MakeRollupRow } from "./make-inventory";
import { VehicleName } from "./vehicle-name";

test("cars taxonomy combines corrected makes and models and resolves legacy URL identities", () => {
  const [make] = MakeInventory.makes([
    { make: "Nissian", count: 5 },
    { make: "Nissan", count: 30 },
  ]);
  if (!make) throw new Error("Missing Nissan");
  expect(make).toMatchObject({
    href: "/cars/nissan",
    count: 35,
    rawMakes: ["Nissan", "Nissian"],
  });
  expect(VehicleName.makeKey("nissian")).toBe(make.key);
  const [ford] = MakeInventory.makes([{ make: "Ford", count: 31 }]);
  if (!ford) throw new Error("Missing Ford");
  const models = MakeInventory.models(
    ford,
    ["FORD F150 PICKUP", "F150", "F-150"].map((model, index) => ({
      source: "pratt",
      code: String(index),
      make: "Ford",
      model,
      count: 10,
      minYear: 2012,
      maxYear: 2012,
    })),
  );
  expect(models).toHaveLength(1);
  const model = models[0];
  if (!model) throw new Error("Missing F-150");
  expect(model).toMatchObject({
    href: "/cars/ford/f-150",
    count: 30,
    rawModels: ["F-150", "F150", "FORD F150 PICKUP"],
  });
  for (const slug of [
    "ford-f150-pickup",
    "ford-f-150-pickup",
    "f150-pickup",
    "f150",
    "f-150",
  ]) {
    expect(VehicleName.modelKey("Ford", slug.replace(/-/g, " "))).toBe(
      model.key,
    );
  }
});

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

  test("folds trim spellings into their base model and names it plainly", () => {
    const [honda] = MakeInventory.makes([{ make: "Honda", count: 10 }]);
    if (!honda) throw new Error("expected Honda");
    const models = MakeInventory.models(honda, [
      row({ make: "Honda", model: "Odyssey SW.", count: 1 }),
      row({ make: "Honda", model: "ODYSSEY", code: "2", count: 5 }),
      row({ make: "Honda", model: "Accord EX", count: 2 }),
      row({ make: "Honda", model: "MOTORCYCLE", count: 8 }),
    ]);
    expect(
      models.map(({ name, count, rawModels }) => ({ name, count, rawModels })),
    ).toEqual([
      { name: "Odyssey", count: 6, rawModels: ["ODYSSEY", "Odyssey SW."] },
      { name: "Accord", count: 2, rawModels: ["Accord EX"] },
    ]);
  });

  test("spans every yard's own range, even one yard's lone oldest year", () => {
    const [honda] = MakeInventory.makes([{ make: "Honda", count: 10 }]);
    if (!honda) throw new Error("expected Honda");
    const civic = (code: string, minYear: number, maxYear: number) =>
      row({ make: "Honda", model: "Civic", code, minYear, maxYear });
    const [model] = MakeInventory.models(honda, [
      civic("1", 1975, 2015),
      civic("2", 1999, 2025),
      civic("3", 2001, 2019),
      civic("4", 2003, 2022),
    ]);
    // The model page lists each yard's range under the model's, so the
    // model's must contain them all.
    expect(model).toMatchObject({ minYear: 1975, maxYear: 2025 });
    for (const yard of model?.yards ?? []) {
      expect(yard.minYear).toBeGreaterThanOrEqual(model?.minYear ?? 0);
      expect(yard.maxYear).toBeLessThanOrEqual(model?.maxYear ?? 0);
    }
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
