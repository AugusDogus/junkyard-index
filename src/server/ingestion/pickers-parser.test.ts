import { expect, test } from "bun:test";
import {
  parsePickersConfig,
  parsePickersInventory,
  parsePickersOwner,
  parsePickersSearch,
  PickersNativeRowSchema,
  pickersValue,
} from "./pickers-parser";
import { transformPickersRecord } from "./pickers-transform";
import {
  pickersTestConfig,
  pickersTestInventory,
  pickersTestOwner,
  pickersTestQuarantine,
  pickersTestRecord,
  pickersTestReject,
  pickersTestSearch,
} from "./pickers-test-fixtures";

test("Pickers binds native whole YMM and optional fields to fallible published VIN enrichment", () => {
  const page = parsePickersInventory(pickersTestInventory());
  const native = PickersNativeRowSchema.parse({
    ...page.rows[0],
    makeIndex: 0,
    ordinal: 0,
  });
  const api = parsePickersSearch(
    pickersTestSearch([
      {
        ...pickersTestRecord,
        make: "TOYOTA",
        model: "DIFFERENT",
        engine: null,
      },
    ]),
    { make: "FORD", model: "FOCUS" },
  )[0];
  if (!api) throw new Error("Missing fixture enrichment");
  expect(transformPickersRecord(native, api)).toMatchObject({
    status: "available",
    vehicle: {
      vin: pickersTestRecord.vin,
      make: "Ford",
      model: "FOCUS",
      engine: "L4, 2.0L",
      imageUrl: "https://pickerstxk.com/PickersInventoryPhotos/STK027498.jpg",
      availableDate: "2026-11-10",
      state: "Arkansas",
      stateAbbr: "AR",
    },
  });
  expect(page.makes).toEqual(["FORD", "BMW"]);
  expect(parsePickersConfig(pickersTestConfig)).toHaveLength(64);
  expect(parsePickersOwner(pickersTestOwner)).toHaveLength(64);
});
test("Pickers rejects invalid and missing enrichment but preserves genuine quarantined identity", () => {
  const page = parsePickersInventory(pickersTestInventory([pickersTestReject]));
  const native = PickersNativeRowSchema.parse({
    ...page.rows[0],
    makeIndex: 1,
    ordinal: 0,
  });
  const pair = { make: "BMW", model: "3 SERIES" };
  const reject = parsePickersSearch(
    pickersTestSearch([pickersTestReject], pair),
    pair,
  )[0];
  const extra = parsePickersSearch(pickersTestSearch([pickersTestQuarantine]), {
    make: "FORD",
    model: "FOCUS",
  })[0];
  if (!reject || !extra) throw new Error("Missing fixture");
  expect(transformPickersRecord(native, reject)).toEqual({
    status: "incomplete",
    vin: null,
    reason: "invalid-required-fields",
  });
  expect(transformPickersRecord(native, null)).toEqual({
    status: "incomplete",
    vin: null,
    reason: "missing-enrichment",
  });
  expect(transformPickersRecord(null, extra)).toEqual({
    status: "quarantined",
    vin: pickersTestQuarantine.vin,
    reason: "active-scope-unproven",
  });
});
test("Pickers optional invalid values become bounded evidence and null canonical data", () => {
  const page = parsePickersInventory(pickersTestInventory());
  const native = PickersNativeRowSchema.parse({
    ...page.rows[0],
    makeIndex: 0,
    ordinal: 0,
    color: pickersValue({ invalid: true }),
    reference: pickersValue("x".repeat(5000)),
    date: pickersValue("02/30/2026"),
    image: pickersValue("javascript:alert(1)"),
    row: pickersValue(false),
  });
  const api = parsePickersSearch(pickersTestSearch([pickersTestRecord]), {
    make: "FORD",
    model: "FOCUS",
  })[0];
  if (!api) throw new Error("Missing fixture");
  expect(native.reference[0]).toBe("unusable");
  expect(transformPickersRecord(native, api)).toMatchObject({
    status: "available",
    vehicle: {
      color: null,
      engine: null,
      availableDate: null,
      imageUrl: null,
      row: null,
    },
  });
});
test("Pickers public and native boundaries reject sibling scope and unsupported table repairs", () => {
  expect(() =>
    parsePickersConfig(
      pickersTestConfig.replace("pickers_texarkana", "pipes_shreveport"),
    ),
  ).toThrow();
  expect(() =>
    parsePickersInventory(
      pickersTestInventory().replace("<tr>", "<tbody><tr>"),
    ),
  ).toThrow();
  expect(() =>
    parsePickersInventory(
      pickersTestInventory().replace("<td>2014</td>", "<td>2014"),
    ),
  ).toThrow();
  expect(() =>
    parsePickersSearch(
      pickersTestSearch([
        { ...pickersTestRecord, yardLocation: "Pipes Shreveport" },
      ]),
      { make: "FORD", model: "FOCUS" },
    ),
  ).toThrow();
});

test("eligible pre-1981 serials and genuine identities survive descriptive rejection", () => {
  const record = { ...pickersTestRecord, year: 1970, vin: "JH23G0B123456" };
  const page = parsePickersInventory(pickersTestInventory([record]));
  const native = PickersNativeRowSchema.parse({
    ...page.rows[0],
    makeIndex: 0,
    ordinal: 0,
  });
  const api = parsePickersSearch(pickersTestSearch([record]), {
    make: "FORD",
    model: "FOCUS",
  })[0];
  if (!api) throw new Error("Missing serial fixture");
  expect(transformPickersRecord(native, api)).toMatchObject({
    status: "available",
    vehicle: { vin: record.vin },
  });
  expect(transformPickersRecord({ ...native, year: null }, api)).toEqual({
    status: "incomplete",
    vin: record.vin,
    reason: "invalid-required-fields",
  });
});

test("malformed optional image links and numbered pagination retain their distinct boundaries", () => {
  const page = pickersTestInventory();
  expect(
    parsePickersInventory(
      page.replace(
        '<img src="../PickersInventoryPhotos/STK027498.jpg">',
        '<img src="http://">',
      ),
    ).rows[0]?.stock,
  ).toBe("STK027498");
  expect(() =>
    parsePickersInventory(
      page.replace(
        "</table>",
        '</table><a rel="next" href="/Home/Inventory?page=2">2</a>',
      ),
    ),
  ).toThrow("pagination");
});

test("the complete native row binds secondary published photo URLs", () => {
  const raw = pickersTestInventory();
  const changed = raw.replace(
    '<img src="../PickersInventoryPhotos/STK027498.jpg">',
    '<img src="../PickersInventoryPhotos/STK027498.jpg?changed=1">',
  );
  const opening = parsePickersInventory(raw).rows[0];
  const closing = parsePickersInventory(changed).rows[0];
  expect(closing?.stock).toBe(opening?.stock);
  expect(closing?.image).toEqual(opening?.image);
  expect(closing?.provenanceHash).not.toBe(opening?.provenanceHash);
});

test("Pickers retains observed recencyAnchor metadata without changing native date authority", () => {
  const record = {
    ...pickersTestRecord,
    recencyAnchor: "2026-11-14T17:00:00-06:00",
  };
  const api = parsePickersSearch(pickersTestSearch([record]), {
    make: "FORD",
    model: "FOCUS",
  })[0];
  expect(api?.fields.recencyAnchor).toEqual(["literal", record.recencyAnchor]);
  const native = PickersNativeRowSchema.parse({
    ...parsePickersInventory(pickersTestInventory()).rows[0],
    makeIndex: 0,
    ordinal: 0,
  });
  if (!api) throw new Error("Missing enrichment");
  expect(transformPickersRecord(native, api)).toMatchObject({
    status: "available",
    vehicle: { availableDate: "2026-11-10" },
  });
});
