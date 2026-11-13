import { expect, test } from "bun:test";
import { brandywineNativeFixtures } from "./brandywine-test-fixtures";
import { parseBrandywineControl } from "./brandywine-catalog";
import { parseBrandywineDetail } from "./brandywine-parser";
import { brandywineDonors } from "./brandywine-cursor";
import {
  brandywineSavedControls,
  brandywineSavedDetails,
  brandywineReference,
} from "./brandywine-test-fixtures";
import { acceptBrandywineDetail } from "./brandywine-parser";
import { brandywineInventorySnapshot } from "./brandywine-transform";

test("native stock and detail bind full YMM without VIN decoding", () => {
  const pages = brandywineNativeFixtures().pages;
  const listing = pages.find((page) =>
    page.source.file.endsWith("breakdown-077.html"),
  );
  const detail = pages.find(
    (page) => page.kind === "detail" && page.url.endsWith("=08B627"),
  );
  if (!listing || !detail) throw new Error("Missing pinned native fixtures");
  const control = parseBrandywineControl(listing.html, listing.url);
  if (control.kind !== "stock")
    throw new Error("Expected native stock control");
  const rows = control.rows.filter((row) => row.stock === "08B627");
  const record = parseBrandywineDetail(
    detail.html,
    detail.url,
    rows.map((row) => ({ ...row, make: "CHEVROLET", scope: "current" })),
  );
  expect(record.status).toBe("required-pass");
  expect(record.candidate).toMatchObject({
    vin: "2G1WG5E36D1261934",
    year: 2013,
    make: "Chevrolet",
    model: "IMPALA",
    stockNumber: "08B627",
    row: "ROW-04",
  });
});

test("every saved native control and all 2,027 donor records match the independent MT21 oracle", () => {
  const opening = brandywineSavedControls("opening");
  const closing = brandywineSavedControls("closing");
  const donors = brandywineDonors(opening);
  expect(opening).toHaveLength(464);
  expect(closing).toHaveLength(464);
  expect(donors).toHaveLength(2027);
  const records = brandywineSavedDetails().map((detail, index) =>
    acceptBrandywineDetail(detail, donors[index]?.bindings ?? []),
  );
  const snapshot = brandywineInventorySnapshot(records);
  expect(snapshot.accounting).toEqual({
    recordsProcessed: 2027,
    recordsExcluded: 209,
    recordsRejected: 11,
    duplicateVehicles: 0,
  });
  const reference = brandywineReference();
  expect(
    [...snapshot.vehicles].sort((a, b) =>
      (a.stockNumber ?? "").localeCompare(b.stockNumber ?? ""),
    ),
  ).toEqual(
    [...reference.canonical].sort((a, b) =>
      a.stockNumber.localeCompare(b.stockNumber),
    ),
  );
  expect(snapshot.observedVins).toEqual(reference.presence);
  expect(
    records.filter(
      (record) =>
        record.status === "required-pass" && record.candidate.year < 1981,
    ),
  ).toHaveLength(3);
});

test("inactive labels never override a native VIN, destination, YMM or yard conflict", () => {
  const donors = brandywineDonors(brandywineSavedControls("opening"));
  const raw = brandywineSavedDetails();
  const index = raw.findIndex((detail) =>
    detail.fields.some(
      (field) => field.label === "Row in Yard:" && field.value === "CRUSHED",
    ),
  );
  const detail = raw[index],
    donor = donors[index];
  if (!detail || !donor) throw new Error("Missing native inactive donor");
  const valid = acceptBrandywineDetail(detail, donor.bindings);
  expect(valid.status).toBe("required-pass");
  const originalVin = valid.validVinClaims[0];
  if (!originalVin) throw new Error("Inactive donor lacks genuine identity");
  const variants = [
    {
      ...detail,
      fields: [...detail.fields, { label: "Vin:", value: "1HGCM82633A004352" }],
    },
    {
      ...detail,
      destinations: [
        "https://www.brandywineupullit.com/veh_single?stockno=OTHER",
      ],
    },
    { ...detail, headings: ["2001 A DIFFERENT MODEL"] },
  ];
  for (const changed of variants) {
    const rejected = acceptBrandywineDetail(changed, donor.bindings);
    expect(rejected.status).toBe("identity-conflict");
    const snapshot = brandywineInventorySnapshot([rejected]);
    expect(snapshot.accounting.recordsExcluded).toBe(0);
    expect(snapshot.observedVins).toContain(originalVin);
  }
  const crossed = acceptBrandywineDetail(detail, [
    ...donor.bindings,
    ...donor.bindings.map((binding) => ({
      ...binding,
      yard: "Fort Washington" as const,
    })),
  ]);
  expect(crossed.status).toBe("identity-conflict");
  expect(
    brandywineInventorySnapshot([crossed]).accounting.recordsExcluded,
  ).toBe(0);
});

test("missing optional fields remain nullable and unknown named markers retain valid VIN presence", () => {
  const donors = brandywineDonors(brandywineSavedControls("opening"));
  const raw = brandywineSavedDetails();
  const detail = raw[0],
    donor = donors[0];
  if (!detail || !donor) throw new Error("Missing native detail");
  const optionalRemoved = {
    ...detail,
    fields: detail.fields.filter((field) =>
      ["Stock Number:", "Vin:"].includes(field.label),
    ),
  };
  const record = acceptBrandywineDetail(optionalRemoved, donor.bindings);
  expect(record.status).toBe("required-pass");
  expect(record.candidate).toMatchObject({
    color: null,
    row: null,
    availableDate: null,
  });
  for (const value of [
    "YARD CAR",
    "CHECK",
    "DOESNOTEXIST",
    "SCRAPPED",
    "NOT AVAILABLE",
    "NO LONGER IN YARD",
    "INACTIVE",
  ]) {
    const rejected = acceptBrandywineDetail(
      {
        ...optionalRemoved,
        fields: [...optionalRemoved.fields, { label: "Row in Yard:", value }],
      },
      donor.bindings,
    );
    expect(rejected.status).toBe("required-reject");
    expect(brandywineInventorySnapshot([rejected]).observedVins).toEqual(
      record.validVinClaims,
    );
  }
  const noIdentity = acceptBrandywineDetail(
    {
      ...detail,
      fields: detail.fields.map((field) =>
        field.label === "Vin:" ? { ...field, value: "" } : field,
      ),
    },
    donor.bindings,
  );
  expect(noIdentity.status).toBe("required-reject");
  expect(noIdentity.validVinClaims).toEqual([]);
});

test("stock controls fail closed on missing yard tables, truncation and unbound destinations", () => {
  const page = brandywineNativeFixtures().pages.find((page) =>
    page.source.file.endsWith("breakdown-001.html"),
  );
  if (!page) throw new Error("Missing native table");
  for (const html of [
    page.html.replace("Fort Washington</h1>", "A different yard</h1>"),
    page.html.slice(0, -20),
    page.html.replace("stockno=08B793", "stockno=WRONG"),
  ])
    expect(() => parseBrandywineControl(html, page.url)).toThrow();
});

test("optional detail stock and positions do not override the verified native stock binding", () => {
  const donors = brandywineDonors(brandywineSavedControls("opening")),
    raw = brandywineSavedDetails();
  const detail = raw[0],
    donor = donors[0];
  if (!detail || !donor) throw new Error("Missing native donor");
  for (const fields of [
    detail.fields.filter((field) => field.label !== "Stock Number:"),
    detail.fields.map((field) =>
      field.label === "Stock Number:" ? { ...field, value: "" } : field,
    ),
  ]) {
    const result = acceptBrandywineDetail(
      { ...detail, fields },
      donor.bindings,
    );
    expect(result.status).toBe("required-pass");
    expect(result.candidate?.stockNumber).toBe(donor.stock);
  }
  for (const value of ["ROW-7", "A-8", "A&B"]) {
    const result = acceptBrandywineDetail(
      {
        ...detail,
        fields: detail.fields.map((field) =>
          field.label === "Row in Yard:" ? { ...field, value } : field,
        ),
      },
      donor.bindings,
    );
    expect(result.status).toBe("required-pass");
    expect(result.candidate?.row).toBe(value === "A&B" ? null : value);
  }
  const conflict = acceptBrandywineDetail(
    {
      ...detail,
      fields: detail.fields.map((field) =>
        field.label === "Stock Number:" ? { ...field, value: "OTHER" } : field,
      ),
    },
    donor.bindings,
  );
  expect(conflict.status).toBe("identity-conflict");
});

test("unresolved native make/model claims reject while invalid optional colors become null", () => {
  const donors = brandywineDonors(brandywineSavedControls("opening")),
    raw = brandywineSavedDetails();
  const detail = raw[0],
    donor = donors[0];
  if (!detail || !donor) throw new Error("Missing native donor");
  for (const make of ["OTHER", "UNKNOWN", "AUSTIN/MG/TRIUMPH"])
    expect(
      acceptBrandywineDetail(
        detail,
        donor.bindings.map((binding) => ({ ...binding, make })),
      ).status,
    ).toBe("required-reject");
  const invalidColor = acceptBrandywineDetail(
    {
      ...detail,
      fields: detail.fields.map((field) =>
        field.label === "Color:" ? { ...field, value: "[2009]" } : field,
      ),
    },
    donor.bindings,
  );
  expect(invalidColor.status).toBe("required-pass");
  expect(invalidColor.candidate?.color).toBe(null);
});
