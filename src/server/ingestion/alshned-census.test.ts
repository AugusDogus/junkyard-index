import { expect, test } from "bun:test";
import { alshnedOpeningFixture, alshnedFixture } from "./alshned-test-fixtures";
import {
  AlshnedCatalog,
  ALSHNED_CATALOG,
  parseAlshnedOwner,
} from "./alshned-parser";
import { AlshnedCursor } from "./alshned-cursor";
import { alshnedSnapshot, validateAlshnedSnapshot } from "./alshned-transform";
const actual = alshnedOpeningFixture();
function closingCursor() {
  const start = AlshnedCursor.start(
    parseAlshnedOwner(alshnedFixture("contact")),
    Buffer.byteLength(alshnedFixture("contact")),
    null,
  );
  if (start.phase !== "catalog")
    throw new Error("Expected owner-validated catalog phase");
  return AlshnedCursor.checkpoint({
    ...start,
    phase: "closing",
    pages: actual.pages,
    donors: actual.donors,
    closing: [],
  });
}
test("all 43 actual primary records reconcile 41 accepted, two rejects, no duplicates", () => {
  const snapshot = validateAlshnedSnapshot(
    alshnedSnapshot(actual.pages, actual.donors),
  );
  expect(snapshot.vehicles.length).toBe(41);
  expect(snapshot.accounting).toEqual({
    recordsProcessed: 43,
    recordsRejected: 2,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  });
  expect(snapshot.observedVins.length).toBe(43);
  expect(snapshot.conflictingVins).toEqual([]);
  expect(() => validateAlshnedSnapshot(snapshot, 100)).toThrow("drift");
});
test("source-wide conflicting VIN claims quarantine every destination including earlier good rows", () => {
  const first = actual.donors[0];
  if (!first) throw new Error("Missing actual first donor");
  const donors = actual.donors.map((d, i) =>
    i === 1
      ? { ...d, vin: first.vin, jsonVin: first.vin, vinClaims: [first.vin] }
      : d,
  );
  const snapshot = alshnedSnapshot(actual.pages, donors);
  expect(snapshot.conflictingVins).toEqual([first.vin]);
  expect(snapshot.accounting.recordsRejected).toBe(4);
  expect(snapshot.vehicles.some((v) => v.vin === first.vin)).toBe(false);
});
test("rejection threshold is assessed over all donors, without repairing native identities", () => {
  const donors = actual.donors.map((d, i) =>
    i < 5 ? { ...d, vin: "", jsonVin: "", vinClaims: [] } : d,
  );
  expect(() =>
    validateAlshnedSnapshot(alshnedSnapshot(actual.pages, donors)),
  ).toThrow("rejection");
});
test("checkpoint roundtrip preserves the ordered census and both real rejects", () => {
  const cursor = closingCursor();
  expect(AlshnedCursor.parse(JSON.parse(JSON.stringify(cursor)))).toEqual(
    cursor,
  );
  expect(Buffer.byteLength(JSON.stringify(cursor))).toBeLessThan(150_000);
  expect(() =>
    AlshnedCursor.parse({ ...cursor, checksum: "0".repeat(64) }),
  ).toThrow("checksum");
  if (cursor.phase !== "closing") throw new Error("Expected closing phase");
  expect(() =>
    AlshnedCursor.checkpoint({
      ...cursor,
      donors: [...cursor.donors].reverse(),
    }),
  ).toThrow("ordered");
  expect(() =>
    AlshnedCursor.checkpoint({ ...cursor, pages: cursor.pages.slice(0, 1) }),
  ).toThrow("frontier");
});
test("closing identity, membership, counts and pagination must match before complete", () => {
  const cursor = closingCursor();
  if (cursor.phase !== "closing") throw new Error("Expected closing phase");
  const first = AlshnedCatalog.parse(
    alshnedFixture("closing-collection"),
    ALSHNED_CATALOG,
  );
  const second = AlshnedCatalog.parse(
    alshnedFixture("closing-page2"),
    first.next ?? "",
  );
  expect(() =>
    AlshnedCursor.checkpoint({
      ...cursor,
      phase: "complete",
      closing: [first],
    }),
  ).toThrow("closing");
  const changed = {
    ...first,
    cards: first.cards.map((c, i) =>
      i ? c : { ...c, vendor: "Foreign supplier" },
    ),
  };
  expect(() =>
    AlshnedCursor.checkpoint({ ...cursor, closing: [changed] }),
  ).toThrow("closing");
  expect(
    AlshnedCursor.checkpoint({
      ...cursor,
      phase: "complete",
      closing: [first, second],
    }).phase,
  ).toBe("complete");
});

test("identical required claims count as duplicates and preserve the 25% ceiling", () => {
  const first = actual.donors[0];
  if (!first) throw new Error("Missing native donor");
  const repeated = (count: number) => {
    const pages = actual.pages.map((p) => ({
      ...p,
      cards: p.cards.map((c) => ({ ...c })),
    }));
    const cards = pages.flatMap((p) => p.cards);
    const donors = actual.donors.map((d, i) => {
      if (i < 1 || i > count) return d;
      const card = cards[i];
      if (!card) throw new Error("Missing ordered duplicate test card");
      card.title = first.card.title;
      card.vendor = first.card.vendor;
      return { ...first, card };
    });
    return alshnedSnapshot(pages, donors);
  };
  const one = repeated(1);
  expect(validateAlshnedSnapshot(one).accounting.duplicateVehicles).toBe(1);
  expect(one.vehicles.length).toBe(40);
  expect(one.accounting.recordsRejected).toBe(2);
  expect(() => validateAlshnedSnapshot(repeated(15))).toThrow("duplicate");
});

test("conflicting active and removed claims quarantine the whole donor identity", () => {
  const first = actual.donors[0];
  if (!first) throw new Error("Missing native donor");
  const pages = actual.pages.map((page) => ({
    ...page,
    cards: page.cards.map((card, index) =>
      page.page === 1 && index === 1
        ? { ...card, title: first.card.title, vendor: first.card.vendor }
        : card,
    ),
  }));
  const cards = pages.flatMap((page) => page.cards);
  const donors = actual.donors.map((donor, index) => {
    if (index !== 1) return donor;
    const card = cards[index];
    if (!card) throw new Error("Missing ordered removed donor card");
    return { ...first, card, active: false };
  });
  const snapshot = alshnedSnapshot(pages, donors);
  expect(snapshot.conflictingVins).toContain(first.vin);
  expect(snapshot.vehicles.some((vehicle) => vehicle.vin === first.vin)).toBe(
    false,
  );
  expect(snapshot.observedVins).toContain(first.vin);
});

test("sold donors are absent from presence and do not count as rejected", () => {
  const donors = actual.donors.map((d, i) =>
    i < 3 ? { ...d, active: false } : d,
  );
  const snapshot = validateAlshnedSnapshot(
    alshnedSnapshot(actual.pages, donors),
  );
  expect(snapshot.accounting).toMatchObject({
    recordsExcluded: 3,
    recordsRejected: 2,
  });
  expect(snapshot.vehicles).toHaveLength(38);
  for (const donor of donors.slice(0, 3))
    expect(snapshot.observedVins).not.toContain(donor.vin);
});
test("excluded donors cannot dilute active rejection ratios", () => {
  const donors = actual.donors.map((d, i) =>
    i < 25
      ? { ...d, active: false }
      : i < 28
        ? { ...d, vin: "", jsonVin: "", vinClaims: [] }
        : d,
  );
  expect(() =>
    validateAlshnedSnapshot(alshnedSnapshot(actual.pages, donors)),
  ).toThrow("rejection");
});
