import { expect, test } from "bun:test";
import { parseImportapartDetail } from "./importapart-parser";
import { transformImportapartRecord } from "./importapart-transform";
import {
  importapartTestDetail,
  importapartTestPost,
} from "./importapart-test-fixtures";

test("Importapart retains a Genesis G80 model while checking BMW chassis-prefixed models", () => {
  const title = "2017 Genesis G80 - PART OUT";
  const record = parseImportapartDetail(
    importapartTestDetail({ title, header: title }),
    { ...importapartTestPost, title },
  );
  expect(transformImportapartRecord(record)).toMatchObject({
    status: "available",
    vehicle: { make: "Genesis", model: "G80" },
  });
  const bmwTitle = "2015 BMW F30 335i - PART OUT";
  const conflict = parseImportapartDetail(
    importapartTestDetail({
      title: bmwTitle,
      header: "2015 BMW F30 328i - PART OUT",
    }),
    { ...importapartTestPost, title: bmwTitle },
  );
  expect(transformImportapartRecord(conflict)).toMatchObject({
    status: "incomplete",
    vin: "JM1NB353710207894",
  });
});

test("Importapart emits native required identity with optional metadata nullable", () => {
  const record = parseImportapartDetail(
    importapartTestDetail({ stock: "NULL" }),
    importapartTestPost,
  );
  expect(transformImportapartRecord(record)).toMatchObject({
    status: "available",
    vehicle: {
      vin: "JM1NB353710207894",
      year: 2001,
      make: "Mazda",
      model: "Miata",
      stockNumber: null,
      color: null,
      imageUrl: null,
      availableDate: null,
      row: null,
      locationCode: "hazelwood",
      stateAbbr: "MO",
    },
  });
});
test("Importapart preserves rejected valid VIN presence for native year conflict", () => {
  const record = parseImportapartDetail(
    importapartTestDetail({ header: "2000 Mazda Miata - PART OUT" }),
    importapartTestPost,
  );
  expect(transformImportapartRecord(record)).toEqual({
    status: "incomplete",
    vin: "JM1NB353710207894",
  });
});
test.each([
  "99-01 Mazda Miata - PART OUT",
  "2001 Special Edition Mazda Miata - PART OUT",
])(
  "Importapart uses a native specific title year and explicit description make (%s)",
  (header) => {
    const record = parseImportapartDetail(
      importapartTestDetail({ header }),
      importapartTestPost,
    );
    expect(transformImportapartRecord(record)).toMatchObject({
      status: "available",
      vehicle: { year: 2001, make: "Mazda", model: "Miata" },
    });
  },
);
test.each([
  "2001 Unknown Miata",
  "2001 Mazda NULL",
  "2001 Mazda -",
  "2002 Mazda Miata",
  "02-06 Mazda Miata",
  "2001 Mazda Protege",
])(
  "Importapart rejects missing or conflicting required source description (%s)",
  (header) => {
    const record = parseImportapartDetail(
      importapartTestDetail({ header }),
      importapartTestPost,
    );
    expect(transformImportapartRecord(record).status).toBe("incomplete");
  },
);
