import { expect, test } from "bun:test";
import { NorthwestRecord } from "./northwest-record";
import { NorthwestSnapshot } from "./northwest-snapshot";

// Test-only coordinates. Production geography must be supplied by the caller.
const location = {
  code: "test-yard",
  name: "Test yard",
  city: "Test city",
  lat: 0,
  lng: 0,
};

// Original browserDOM NW-00062 and NW-04254, independently reviewed as
// CONFLICT-001. Captures 027-model and 171-model-recovered respectively.
test("quarantines both native BMW/GMC appearances of the same VIN", () => {
  const records = [
    {
      occurrenceId: "NW-00062",
      sourceUrl: "https://northwestautoparts.com/parts/BMW/BMW_X5/",
      context: {
        kind: "model",
        make: { path: "/parts/BMW", label: "BMW" },
        model: { path: "/parts/BMW/BMW_X5/", label: "BMW X5" },
      },
      years: ["2015"],
      titles: ["BMW X5"],
      vins: ["2GKFLWE33F6174270"],
      inquiries: ["2015 BMW BMW X5 - VIN 2GKFLWE33F6174270"],
      destinations: ["//northwestautoparts.com/parts/BMW/BMW_X5/F302/2015"],
    },
    {
      occurrenceId: "NW-04254",
      sourceUrl: "https://northwestautoparts.com/parts/GMC/TERRAIN/",
      context: {
        kind: "model",
        make: { path: "/parts/GMC", label: "GMC" },
        model: { path: "/parts/GMC/TERRAIN/", label: "TERRAIN" },
      },
      years: ["2015"],
      titles: ["GMC TERRAIN"],
      vins: ["2GKFLWE33F6174270"],
      inquiries: ["2015 GMC TERRAIN - VIN 2GKFLWE33F6174270"],
      destinations: ["//northwestautoparts.com/parts/GMC/TERRAIN/F302/2015"],
    },
  ];
  const result = NorthwestSnapshot.create(
    { evidenceKind: "browserDOM", records },
    location,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.candidates).toEqual([]);
  expect(result.value.accounting).toEqual({
    recordsProcessed: 2,
    recordsRejected: 2,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  });
  expect(result.value.quarantinedRecordIndices).toEqual([0, 1]);
  expect(result.value.observedVins).toEqual(["2GKFLWE33F6174270"]);
});

// Synthetic mutations below isolate graph and accounting behavior. These are
// not additional original captures or evidence for source enumeration.
const synthetic = (number: number) =>
  NorthwestRecord.schema.parse({
    occurrenceId: `synthetic-${number}`,
    sourceUrl: "https://northwestautoparts.com/parts/ACURA/RDX/",
    context: {
      kind: "model",
      make: { path: "/parts/ACURA", label: "ACURA" },
      model: { path: "/parts/ACURA/RDX/", label: "RDX" },
    },
    years: ["2010"],
    titles: ["ACURA RDX"],
    vins: [`5J8TB1H23AA00${String(number).padStart(4, "0")}`],
    destinations: [`Q${number}/2010`],
  });

test("destination conflicts quarantine a connected chain while unrelated donors survive", () => {
  const a = synthetic(1),
    b = synthetic(2),
    c = synthetic(3),
    d = synthetic(4),
    safe = synthetic(5);
  const records = [
    a,
    { ...b, destinations: a.destinations },
    { ...c, vins: b.vins },
    { ...d, destinations: c.destinations },
    safe,
  ];
  const input = { evidenceKind: "browserDOM", records };
  const before = structuredClone(input);
  const result = NorthwestSnapshot.create(input, location);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.candidates.map((row) => row.vin)).toEqual(safe.vins);
  expect(result.value.quarantinedRecordIndices).toEqual([0, 1, 2, 3]);
  expect(result.value.accounting).toEqual({
    recordsProcessed: 5,
    recordsRejected: 4,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  });
  expect(result.value.observedVins).toEqual([
    ...a.vins,
    ...b.vins,
    ...d.vins,
    ...safe.vins,
  ]);
  expect(
    result.value.conflicts.some((group) => group.domain === "destination"),
  ).toBe(true);
  expect(input).toEqual(before);
});

test("an internally conflicting occurrence connects every asserted VIN before dedup", () => {
  const a = synthetic(1),
    b = synthetic(2),
    c = synthetic(3);
  const result = NorthwestSnapshot.create(
    {
      evidenceKind: "browserDOM",
      records: [a, b, { ...c, vins: [...a.vins, ...b.vins] }],
    },
    location,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.candidates).toEqual([]);
  expect(result.value.accounting.recordsRejected).toBe(3);
  expect(result.value.accounting.duplicateVehicles).toBe(0);
  expect(result.value.observedVins).toEqual([...a.vins, ...b.vins]);
});

test("native make conflicts remain conflicts before canonical display normalization", () => {
  const a = synthetic(1),
    b = synthetic(2);
  const records = ["CHEVY", "CHEVROLET"].map((make, index) => ({
    ...a,
    occurrenceId: `make-${index}`,
    titles: [`${make} IMPALA`],
    sourceUrl: `https://northwestautoparts.com/parts/${make}/IMPALA/`,
    context: {
      kind: "model",
      make: { path: `/parts/${make}`, label: make },
      model: { path: `/parts/${make}/IMPALA/`, label: "IMPALA" },
    },
  }));
  const result = NorthwestSnapshot.create(
    { evidenceKind: "browserDOM", records: [...records, b] },
    location,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.accounting.recordsRejected).toBe(2);
  expect(result.value.candidates.map((row) => row.vin)).toEqual(b.vins);
});

test("valid rejected VIN presence survives a missing native model", () => {
  const a = synthetic(1);
  const result = NorthwestSnapshot.create(
    { evidenceKind: "browserDOM", records: [{ ...a, titles: [] }] },
    location,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.candidates).toEqual([]);
  expect(result.value.observedVins).toEqual(a.vins);
  expect(result.value.occurrences[0]).toMatchObject({
    status: "rejected",
    reasons: ["native-parent-leaf-title-mismatch"],
  });
});

test("benign duplicate metadata conflicts remain nullable diagnostics", () => {
  const a = synthetic(1);
  const vin = a.vins[0];
  if (vin === undefined) throw new Error("Synthetic donor lost its VIN");
  const records = [
    { ...a, stockNumbers: ["ONE"], colors: ["RED"], rows: ["1"] },
    {
      ...a,
      occurrenceId: "duplicate",
      stockNumbers: ["TWO"],
      colors: ["BLUE"],
      rows: ["2"],
    },
  ];
  const result = NorthwestSnapshot.create(
    { evidenceKind: "browserDOM", records },
    location,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.candidates).toHaveLength(1);
  expect(result.value.candidates[0]).toMatchObject({
    stockNumber: null,
    color: null,
    row: null,
  });
  expect(result.value.optionalConflicts).toEqual([
    { vin, field: "stockNumber", values: ["ONE", "TWO"] },
    { vin, field: "color", values: ["RED", "BLUE"] },
    { vin, field: "row", values: ["1", "2"] },
  ]);
  expect(result.value.accounting).toEqual({
    recordsProcessed: 2,
    recordsRejected: 0,
    recordsExcluded: 0,
    duplicateVehicles: 1,
  });
  expect(result.value.quarantinedRecordIndices).toEqual([]);
  expect(result.value.occurrences.map((row) => row.status)).toEqual([
    "candidate",
    "duplicate",
  ]);
});

test("optional merging does not let a missing or invalid first value pick a winner", () => {
  const a = synthetic(1);
  const result = NorthwestSnapshot.create(
    {
      evidenceKind: "browserDOM",
      records: [
        { ...a, imageUrls: ["https://example.com/wrong.jpg"] },
        {
          ...a,
          occurrenceId: "duplicate",
          stockNumbers: ["LITERAL"],
          imageUrls: ["/native.jpg"],
        },
      ],
    },
    location,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.candidates[0]).toMatchObject({
    stockNumber: "LITERAL",
    imageUrl: null,
  });
  expect(result.value.optionalConflicts[0]?.values).toEqual([
    "https://example.com/wrong.jpg",
    "https://northwestautoparts.com/native.jpg",
  ]);
});

test("shared YMM or optional stock alone does not join different native identities", () => {
  const records = [synthetic(1), synthetic(2)].map((row) => ({
    ...row,
    stockNumbers: ["SAME"],
  }));
  const result = NorthwestSnapshot.create(
    { evidenceKind: "browserDOM", records },
    location,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.candidates).toHaveLength(2);
  expect(result.value.accounting.recordsRejected).toBe(0);
  expect(result.value.accounting.duplicateVehicles).toBe(0);
});

test("optional image claims resolve against each original page before merging", () => {
  const a = synthetic(1);
  const result = NorthwestSnapshot.create(
    {
      evidenceKind: "browserDOM",
      records: [
        {
          ...a,
          imageUrls: ["photo.jpg"],
          destinations: [
            "https://northwestautoparts.com/parts/ACURA/RDX/Q1/2010",
          ],
        },
        {
          ...a,
          occurrenceId: "duplicate",
          sourceUrl: a.sourceUrl.replace(/\/$/, ""),
          imageUrls: ["photo.jpg"],
          destinations: [
            "https://northwestautoparts.com/parts/ACURA/RDX/Q1/2010",
          ],
        },
      ],
    },
    location,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.candidates[0]?.imageUrl).toBeNull();
  expect(result.value.optionalConflicts).toEqual([
    {
      vin: a.vins[0] ?? "",
      field: "imageUrl",
      values: [
        "https://northwestautoparts.com/parts/ACURA/RDX/photo.jpg",
        "https://northwestautoparts.com/parts/ACURA/photo.jpg",
      ],
    },
  ]);
});

test.each(["/native\n.jpg", "/native\t.jpg", "\u0000/native.jpg"])(
  "photo merge preserves malformed literals and their conflicts: %j",
  (malformed) => {
    const a = synthetic(1);
    for (const imageUrls of [[malformed], ["/native.jpg", malformed]]) {
      const result = NorthwestSnapshot.create(
        { evidenceKind: "browserDOM", records: [{ ...a, imageUrls }] },
        location,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.value.candidates).toHaveLength(1);
      expect(result.value.candidates[0]?.imageUrl).toBeNull();
      expect(result.value.accounting.recordsRejected).toBe(0);
      if (imageUrls.length > 1) {
        expect(result.value.optionalConflicts).toEqual([
          {
            vin: a.vins[0] ?? "",
            field: "imageUrl",
            values: ["https://northwestautoparts.com/native.jpg", malformed],
          },
        ]);
      }
    }
  },
);

test("quality uses the occurrence partition and existing 10% and 25% ratio boundaries", () => {
  const records = Array.from({ length: 10 }, (_, index) => synthetic(index));
  for (const rejects of [1, 2]) {
    const changed = records.map((row, index) =>
      index < rejects ? { ...row, vins: [] } : row,
    );
    const result = NorthwestSnapshot.create(
      { evidenceKind: "browserDOM", records: changed },
      location,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.quality.rejectionRatio).toBe(rejects / 10);
    expect(
      result.value.quality.issues.includes("rejection-ratio-exceeded"),
    ).toBe(rejects === 2);
    expect(
      result.value.candidates.length +
        result.value.accounting.recordsRejected +
        result.value.accounting.duplicateVehicles,
    ).toBe(result.value.accounting.recordsProcessed);
  }
  const a = synthetic(1),
    b = synthetic(2),
    c = synthetic(3);
  for (const duplicate of [false, true]) {
    const result = NorthwestSnapshot.create(
      {
        evidenceKind: "browserDOM",
        records: [
          a,
          { ...a, occurrenceId: "duplicate" },
          duplicate ? { ...a, occurrenceId: "duplicate-two" } : b,
          c,
        ],
      },
      location,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.quality.duplicateRatio).toBe(duplicate ? 0.5 : 0.25);
    expect(
      result.value.quality.issues.includes("duplicate-ratio-exceeded"),
    ).toBe(duplicate);
  }
});

test("boundary errors preserve a distinct failure value and cannot masquerade as empty success", () => {
  const a = synthetic(1);
  for (const input of [
    null,
    { evidenceKind: "rawHTTP", records: [a] },
    { evidenceKind: "browserDOM", records: [a, a] },
    { evidenceKind: "browserDOM", records: [{ ...a, vins: "wrong" }] },
  ]) {
    const result = NorthwestSnapshot.create(input, location);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.tag).toBe("NorthwestSnapshotError");
    expect(result.error.detail).toContain("Prior inventory is preserved");
  }
  expect(
    NorthwestSnapshot.create(
      { evidenceKind: "browserDOM", records: [a] },
      { ...location, lat: NaN },
    ).ok,
  ).toBe(false);
  const empty = NorthwestSnapshot.create(
    { evidenceKind: "browserDOM", records: [] },
    location,
  );
  expect(empty.ok).toBe(true);
  if (!empty.ok) return;
  expect(empty.value.quality).toEqual({
    denominator: 0,
    rejectionRatio: null,
    duplicateRatio: null,
    issues: ["empty-frozen-occurrences"],
  });
});
