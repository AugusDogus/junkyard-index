import { describe, expect, test } from "bun:test";
import {
  parseJimsimportDirectory,
  parseJimsimportModel,
  parseJimsimportOwner,
} from "./jimsimport-parser";
import { assessJimsimportRecord } from "./jimsimport-transform";
import { jimsimportFixture } from "./jimsimport-test-fixtures";

function context(makeIndex = 0, modelIndex = 1) {
  const make = parseJimsimportDirectory(jimsimportFixture("catalog").body)[
    makeIndex
  ];
  if (!make) throw new Error("Missing native make");
  const model = parseJimsimportDirectory(
    jimsimportFixture(makeIndex === 0 ? "acura" : "audi").body,
    make,
  )[modelIndex];
  if (!model) throw new Error("Missing native model");
  return { make, model };
}
describe("Jim's Import actual native catalog", () => {
  test("NN38 physical owner and complete published makes and models", () => {
    expect(parseJimsimportOwner(jimsimportFixture("owner").body)).toHaveLength(
      64,
    );
    const makes = parseJimsimportDirectory(jimsimportFixture("catalog").body);
    expect(makes).toHaveLength(33);
    expect(makes[0]?.label).toBe("ACURA");
    expect(context().model.label).toBe("ILX");
  });
  test("explicit four-digit year, VIN, title and native destination agree", () => {
    const c = context(),
      page = parseJimsimportModel(
        jimsimportFixture("ilx").body,
        c.make,
        c.model,
      );
    expect(page.records).toHaveLength(6);
    const record = page.records[0];
    if (!record) throw new Error("Missing native donor");
    const result = assessJimsimportRecord(record, c);
    expect(result.reasons).toEqual([]);
    expect(result.vehicle?.vin).toBe("19UDE2F72LA002870");
    expect(result.vehicle?.year).toBe(2020);
    expect(result.vehicle?.make).toBe("Acura");
    expect(result.vehicle?.model).toBe("ILX");
    expect(result.vehicle?.detailsUrl).toBe(
      "https://jimsimport.com/used-parts/ACURA/ILX/21F104/2020",
    );
    expect(result.vehicle?.imageUrl).toBe(
      "https://da8h1v3w8q6n5.cloudfront.net/nn38/images/21F104/21F104_1.jpg",
    );
    expect(result.vehicle?.color).toBeNull();
    expect(result.vehicle?.availableDate).toBeNull();
    expect(result.vehicle?.row).toBeNull();
  });
  test("native model controls which already include make are delimited once", () => {
    const c = context(2, 0),
      page = parseJimsimportModel(
        jimsimportFixture("a3").body,
        c.make,
        c.model,
      );
    const record = page.records[0];
    if (!record) throw new Error("Missing native Audi");
    const result = assessJimsimportRecord(record, c);
    expect(result.vehicle?.make).toBe("Audi");
    expect(result.vehicle?.model).toBe("A3");
    expect(result.reasons).toEqual([]);
  });
  test("missing identity remains a reject without VIN or heading inference", () => {
    const c = context(0, 0),
      record = parseJimsimportModel(
        jimsimportFixture("cl").body,
        c.make,
        c.model,
      ).records[0];
    if (!record) throw new Error("Missing native CL");
    expect(assessJimsimportRecord(record, c).reasons).toContain(
      "missing-or-invalid-native-identity",
    );
    expect(
      assessJimsimportRecord(
        { ...record, vin: "19UDE2F72LA002870", title: "" },
        c,
      ).vehicle,
    ).toBeNull();
  });
  test("native empty leaf is accounted for, absent or partial cards fail closed", () => {
    const c = context();
    expect(
      parseJimsimportModel(jimsimportFixture("empty").body, c.make, c.model)
        .records,
    ).toEqual([]);
    expect(() =>
      parseJimsimportModel(
        jimsimportFixture("ilx").body.replaceAll(
          "aps-la-card-premium",
          "lost-card",
        ),
        c.make,
        c.model,
      ),
    ).toThrow("census");
    expect(() =>
      parseJimsimportDirectory(
        jimsimportFixture("catalog").body.replace(/<\/html>/i, ""),
      ),
    ).toThrow("incomplete");
  });
  test("new continuations, foreign suppliers and broken directory controls stop", () => {
    const c = context(),
      raw = jimsimportFixture("ilx").body;
    expect(() =>
      parseJimsimportModel(
        raw.replace(
          '<div class="aps-la-grid',
          '<a rel="next" href="?page=2">Next page</a><div class="aps-la-grid',
        ),
        c.make,
        c.model,
      ),
    ).toThrow("continuation");
    expect(() =>
      parseJimsimportModel(
        raw.replace("var urgid = 'NN38'", "var urgid = 'OTHER'"),
        c.make,
        c.model,
      ),
    ).toThrow("supplier");
    expect(() =>
      parseJimsimportDirectory(
        jimsimportFixture("acura").body.replace(
          '/used-parts/ACURA/CL"',
          '/used-parts/OTHER/CL"',
        ),
        c.make,
      ),
    ).toThrow("control");
  });
  test("native stock and year joins are required, optional foreign photos become null", () => {
    const c = context(),
      r = parseJimsimportModel(jimsimportFixture("ilx").body, c.make, c.model)
        .records[0];
    if (!r) throw new Error("Missing native ILX");
    expect(
      assessJimsimportRecord({ ...r, id: "different" }, c).vehicle,
    ).toBeNull();
    expect(assessJimsimportRecord({ ...r, year: "20" }, c).vehicle).toBeNull();
    expect(
      assessJimsimportRecord(
        {
          ...r,
          destinations: [...r.destinations, "https://foreign.example/donor"],
        },
        c,
      ).vehicle,
    ).toBeNull();
    expect(
      assessJimsimportRecord(
        { ...r, image: r.image?.replace("21F104/", "another/") ?? null },
        c,
      ).vehicle?.imageUrl,
    ).toBeNull();
  });
  test("ambiguous optional image regions retain the required donor with a null photo", () => {
    const c = context();
    const raw = jimsimportFixture("ilx").body.replace(
      '<div class="aps-la-img-wrap-premium',
      '<div class="aps-la-img-wrap-premium"></div><div class="aps-la-img-wrap-premium',
    );
    const record = parseJimsimportModel(raw, c.make, c.model).records[0];
    if (!record) throw new Error("Missing native ILX");
    const result = assessJimsimportRecord(record, c);
    expect(result.reasons).toEqual([]);
    expect(result.vehicle?.vin).toBe("19UDE2F72LA002870");
    expect(result.vehicle?.imageUrl).toBeNull();
  });
  test("pagination outside the current donor grid cannot hide behind gallery controls", () => {
    const c = context();
    const raw = jimsimportFixture("ilx").body.replace(
      '<div class="bootstrapiis aps-modal-wrapper">',
      '<a rel="next" href="?page=2">Next</a><div class="bootstrapiis aps-modal-wrapper">',
    );
    expect(() => parseJimsimportModel(raw, c.make, c.model)).toThrow(
      "continuation",
    );
  });
});
