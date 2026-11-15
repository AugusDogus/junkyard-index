import { describe, expect, test } from "bun:test";
import { NorthwestRecord } from "./northwest-record";

// Original browserDOM: northwest_continue/006-model-capture.json,
// /rowChunks/0/rows/0 (NW-00003). No HTML or transport is inferred here.
const rdx = {
  occurrenceId: "NW-00003",
  sourceUrl: "https://northwestautoparts.com/parts/ACURA/RDX/",
  context: {
    kind: "model",
    make: { path: "/parts/ACURA", label: "ACURA" },
    model: { path: "/parts/ACURA/RDX/", label: "RDX" },
  },
  years: ["2010"],
  titles: ["ACURA RDX"],
  vins: ["5J8TB1H23AA002695"],
  inquiries: ["2010 ACURA RDX - VIN 5J8TB1H23AA002695"],
  destinations: ["//northwestautoparts.com/parts/ACURA/RDX/Q367/2010"],
  stockNumbers: ["Q367"],
} as const;

describe("Northwest native claims", () => {
  test("assesses a real native RDX without borrowing another source boundary", () => {
    const parsed = NorthwestRecord.schema.safeParse(rdx);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const assessment = NorthwestRecord.assess(parsed.data);
    expect(assessment.status).toBe("required-pass");
    expect(assessment.reasons).toEqual([]);
    expect(assessment.validVinClaims).toEqual(["5J8TB1H23AA002695"]);
    expect(assessment.resolvedDestinations).toEqual([
      {
        literal: rdx.destinations[0],
        url: "https://northwestautoparts.com/parts/ACURA/RDX/Q367/2010",
      },
    ]);
  });

  test("validates unknown inputs and retains every original required claim", () => {
    for (const input of [
      null,
      [],
      { ...rdx, years: "2010" },
      { ...rdx, injected: true },
    ])
      expect(NorthwestRecord.parse(input).success).toBe(false);
    const input = {
      ...rdx,
      years: ["2010", "2010"],
      titles: ["ACURA RDX", "ACURA RDX"],
    };
    const parsed = NorthwestRecord.parse(input);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const before = structuredClone(parsed.data);
    const result = NorthwestRecord.assess(parsed.data);
    expect(result.status).toBe("required-pass");
    expect(result.record).toEqual(before);
    expect(result.record.years).toEqual(input.years);
    expect(result.record.titles).toEqual(input.titles);
    expect(result.record.context).toEqual(rdx.context);
    expect(result.record.sourceUrl).toBe(rdx.sourceUrl);
    expect(result.record.destinations).toEqual([...rdx.destinations]);
    expect(parsed.data).toEqual(before);
  });

  test("inquiry and all optional metadata can be absent", () => {
    const input = {
      occurrenceId: rdx.occurrenceId,
      sourceUrl: rdx.sourceUrl,
      context: rdx.context,
      years: rdx.years,
      titles: rdx.titles,
      vins: rdx.vins,
      destinations: rdx.destinations,
    };
    const parsed = NorthwestRecord.parse(input);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.inquiries).toEqual([]);
    expect(parsed.data.stockNumbers).toEqual([]);
    expect(NorthwestRecord.assess(parsed.data).status).toBe("required-pass");
  });

  test("real Volvo card and repeated-make inquiry agree without model inference", () => {
    // Original browserDOM 336-model-capture.json /rowChunks/0/rows/0, NW-06932.
    const record = NorthwestRecord.schema.parse({
      occurrenceId: "NW-06932",
      sourceUrl: "https://northwestautoparts.com/parts/VOLVO/VOLVO_60_SERIES/",
      context: {
        kind: "model",
        make: { path: "/parts/VOLVO", label: "VOLVO" },
        model: {
          path: "/parts/VOLVO/VOLVO_60_SERIES/",
          label: "VOLVO 60 SERIES",
        },
      },
      years: ["2013"],
      titles: ["VOLVO 60 SERIES"],
      vins: ["YV4902DZ8D2416106"],
      inquiries: ["2013 VOLVO VOLVO 60 SERIES - VIN YV4902DZ8D2416106"],
      destinations: [
        "//northwestautoparts.com/parts/VOLVO/VOLVO_60_SERIES/N279/2013",
      ],
    });
    const assessed = NorthwestRecord.assess(record);
    expect(assessed.status).toBe("required-pass");
    expect(assessed.identity?.make).toBe("VOLVO");
    expect(assessed.identity?.model).toBe("60 SERIES");
    expect(new Set(assessed.nativeClaims.makeModels).size).toBe(1);
  });

  test("synthetic missing or partial card YMM is never filled from inquiry or route", () => {
    for (const change of [
      { titles: [] },
      { titles: ["RDX"] },
      { years: ["10"] },
      { years: [] },
    ] as const) {
      const record = NorthwestRecord.schema.parse({ ...rdx, ...change });
      expect(NorthwestRecord.assess(record).status).toBe("required-reject");
    }
    // The real review preserves a bare LAND ROVER title as a required reject.
    const record = NorthwestRecord.schema.parse({
      ...rdx,
      inquiries: [],
      titles: ["LAND ROVER"],
      context: {
        kind: "model",
        make: { path: "/parts/LAND_ROVER", label: "LAND ROVER" },
        model: { path: "/parts/LAND_ROVER/LAND_ROVER/", label: "LAND ROVER" },
      },
      sourceUrl: "https://northwestautoparts.com/parts/LAND_ROVER/LAND_ROVER/",
      destinations: ["Q367/2010"],
    });
    expect(NorthwestRecord.assess(record).reasons).toContain(
      "native-parent-leaf-title-mismatch",
    );
  });

  test("uses unchanged inventoryVin semantics, including native older serial years", () => {
    for (const [year, vin, expected] of [
      ["1980", "ABC12345", "required-pass"],
      ["1981", "ABC12345", "required-reject"],
      ["1885", "ABC12345", "required-reject"],
      ["1970", "ABCDEFG", "required-reject"],
      ["2010", "5j8tb1h23aa002695", "required-pass"],
      ["2010", "5J8TB1H23AA00269I", "required-reject"],
    ] as const) {
      const record = NorthwestRecord.schema.parse({
        ...rdx,
        years: [year],
        vins: [vin],
        inquiries: [],
        destinations: [`Q367/${year}`],
      });
      expect(NorthwestRecord.assess(record).status).toBe(expected);
    }
  });

  test("resolves a literal relative href against the actual source page", () => {
    const record = NorthwestRecord.schema.parse({
      ...rdx,
      destinations: ["Q367/2010"],
    });
    expect(NorthwestRecord.assess(record).status).toBe("required-pass");
    const noSlash = {
      ...record,
      sourceUrl: record.sourceUrl.replace(/\/$/, ""),
    };
    expect(NorthwestRecord.assess(noSlash).status).toBe("required-reject");
  });

  test("synthetic foreign, wrong-parent, query, credential and partial-year destinations fail", () => {
    for (const destination of [
      "https://example.com/parts/ACURA/RDX/Q367/2010",
      "http://northwestautoparts.com/parts/ACURA/RDX/Q367/2010",
      "https://user@northwestautoparts.com/parts/ACURA/RDX/Q367/2010",
      "Q367/2010?inventory=1",
      "Q367/2010#parts",
      "Q367/10",
      "../MDX/Q367/2010",
      "Q367/2011",
      "",
    ]) {
      const record = NorthwestRecord.schema.parse({
        ...rdx,
        destinations: [destination],
      });
      expect(NorthwestRecord.assess(record).reasons).toContain(
        "native-donor-destination-missing-conflicting-or-unowned",
      );
    }
    const record = NorthwestRecord.schema.parse(rdx);
    expect(
      NorthwestRecord.assess({
        ...record,
        sourceUrl: "https://example.com/parts/ACURA/RDX/",
      }).reasons,
    ).toContain("native-source-page-context-mismatch");
  });

  test("synthetic conflicting required arrays retain all valid VIN claims", () => {
    const otherVin = "2GKFLWE33F6174270";
    const record = NorthwestRecord.schema.parse({
      ...rdx,
      years: ["2010", "2011"],
      titles: ["ACURA RDX", "ACURA MDX"],
      vins: [...rdx.vins, otherVin],
      destinations: [...rdx.destinations, "Q999/2010"],
    });
    const assessed = NorthwestRecord.assess(record);
    expect(assessed.status).toBe("required-reject");
    expect(assessed.reasons).toContain("conflicting-native-required-claims");
    expect(assessed.validVinClaims).toEqual([otherVin, ...rdx.vins]);
    expect(assessed.record.vins).toEqual(record.vins);
    expect(assessed.nativeClaims.destinations).toHaveLength(2);
  });

  test("synthetic malformed or conflicting inquiries reject without hiding valid identities", () => {
    const record = NorthwestRecord.schema.parse({
      ...rdx,
      inquiries: ["bad inquiry 2GKFLWE33F6174270"],
    });
    const assessed = NorthwestRecord.assess(record);
    expect(assessed.status).toBe("required-reject");
    expect(assessed.reasons).toContain("native-inquiry-identity-mismatch");
    expect(assessed.validVinClaims).toEqual(["2GKFLWE33F6174270", ...rdx.vins]);
  });

  test("real bare LAND ROVER remains a missing-model reject without inventing a contradiction", () => {
    // NW-05429, 222-model-capture.json /rowChunks/0/rows/0.
    const record = NorthwestRecord.schema.parse({
      occurrenceId: "NW-05429",
      sourceUrl: "https://northwestautoparts.com/parts/LAND_ROVER/LAND_ROVER/",
      context: {
        kind: "model",
        make: { path: "/parts/LAND_ROVER", label: "LAND ROVER" },
        model: { path: "/parts/LAND_ROVER/LAND_ROVER/", label: "LAND ROVER" },
      },
      years: ["1999"],
      titles: ["LAND ROVER"],
      vins: ["SALTY1244XA231606"],
      inquiries: ["1999 LAND ROVER LAND ROVER - VIN SALTY1244XA231606"],
      destinations: [
        "//northwestautoparts.com/parts/LAND_ROVER/LAND_ROVER/S552/1999",
      ],
    });
    const assessment = NorthwestRecord.assess(record);
    expect(assessment.status).toBe("required-reject");
    expect(assessment.reasons).toEqual(["native-parent-leaf-title-mismatch"]);
    expect(assessment.validVinClaims).toEqual(["SALTY1244XA231606"]);
  });
});
