import { describe, expect, test } from "bun:test";
import { KandrNative } from "./kandr-native";
import { KandrSnapshot } from "./kandr-snapshot";
import { kandrFixture } from "./kandr-test-fixtures";

const pages = kandrFixture.opening.map((r) =>
  KandrNative.listing(r.html, r.url),
);
const details = kandrFixture.details.map((r) =>
  KandrNative.detail(r.html, r.url),
);
const snapshot = () =>
  KandrSnapshot.create(structuredClone(pages), structuredClone(details));

describe("K&R complete donor quality", () => {
  test("replays all 49 real donors and protects the component-only VIN", () => {
    const result = snapshot();
    expect(result.vehicles).toHaveLength(48);
    expect(result.accounting).toEqual({
      recordsProcessed: 49,
      recordsRejected: 1,
      recordsExcluded: 0,
      duplicateVehicles: 0,
    });
    expect(result.observedVins).toEqual(["3HSDJSJR0DN170483"]);
    expect(result.rejects).toEqual([
      {
        id: "6483483/1/81643",
        reasons: ["component-only-scope-conflict"],
        validVins: ["3HSDJSJR0DN170483"],
      },
    ]);
    expect(() => KandrSnapshot.validate(result, 40, null)).not.toThrow();
  });
  test("keeps absent optional metadata null and accepts missing quantity", () => {
    const changed = structuredClone(details);
    const first = changed[0];
    const page = structuredClone(pages);
    const card = page[0]?.cards[0];
    if (!first || !card) throw new Error("Missing actual donor");
    first.images = [];
    delete first.fields["Tag #"];
    delete first.fields["Available Quantity"];
    delete card.fields["Tag #"];
    const result = KandrSnapshot.create(page, changed);
    expect(result.vehicles[0]).toMatchObject({
      vin: "4V4NC9EG1CN543067",
      year: 2012,
      make: "Volvo",
      model: "VNL860",
      stockNumber: null,
      imageUrl: null,
      color: null,
      availableDate: null,
      section: null,
      row: null,
      space: null,
    });
    expect(result.vehicles).toHaveLength(48);
  });
  test("retains real vehicle make when the native heading omits Part Manufacturer", () => {
    const detail = details.find((row) => row.id === "6483483/1/70675");
    expect(detail?.title).toBe("2010 Prostar Dismantled Vehicles");
    expect(detail?.fields["Part Manufacturer"]).toBeUndefined();
    expect(
      snapshot().vehicles.find((row) => row.vin === "3HSCUAPR7AN206637"),
    ).toMatchObject({ year: 2010, make: "International", model: "Prostar" });
  });
  test("rejects required identity conflicts and propagates connected VIN rejects", () => {
    const changed = structuredClone(details);
    const first = changed[0],
      second = changed[1],
      third = changed[2];
    if (!first || !second || !third) throw new Error("Missing actual donors");
    first.fields.VIN = ["4V4NC9EG1CN543067", "4V4M99DG9FN911124"];
    second.fields.VIN = ["4V4M99DG9FN911124", "4V4M99DG4GN949863"];
    third.fields.VIN = ["4V4M99DG4GN949863"];
    delete first.fields["Vehicle Make"];
    const result = KandrSnapshot.create(pages, changed);
    expect(result.vehicles).toHaveLength(45);
    expect(result.accounting.recordsRejected).toBe(4);
    expect(result.observedVins).toContain("4V4NC9EG1CN543067");
    expect(result.observedVins).toContain("4V4M99DG9FN911124");
    expect(result.observedVins).toContain("4V4M99DG4GN949863");
  });
  test("protects a supported older serial when required year labels conflict", () => {
    const changed = structuredClone(details);
    const first = changed[0];
    if (!first) throw new Error("Missing actual donor");
    first.fields.Year = ["1978", "1979"];
    first.fields.VIN = ["ABC123456"];
    const result = KandrSnapshot.create(pages, changed);
    expect(result.accounting.recordsRejected).toBe(2);
    expect(result.observedVins).toContain("ABC123456");
  });
  test("enforces graph joins, unavailable donor rejection, floors and quality ratios", () => {
    expect(() => KandrSnapshot.create(pages, details.slice(1))).toThrow(
      "reconcile",
    );
    const changed = structuredClone(details);
    const first = changed[0];
    if (!first) throw new Error("Missing actual donor");
    first.fields["Available Quantity"] = ["0"];
    expect(
      KandrSnapshot.create(pages, changed).accounting.recordsRejected,
    ).toBe(2);
    expect(() => KandrSnapshot.validate(snapshot(), 49, null)).toThrow(
      "minimum",
    );
    expect(() => KandrSnapshot.validate(snapshot(), 40, 100)).toThrow("drift");
    const rejected = snapshot();
    rejected.accounting.recordsRejected = 6;
    rejected.accounting.recordsProcessed += 5;
    expect(() => KandrSnapshot.validate(rejected, 40, null)).toThrow(
      "rejection",
    );
    const duplicate = snapshot();
    duplicate.accounting.duplicateVehicles = 20;
    duplicate.accounting.recordsProcessed += 20;
    expect(() => KandrSnapshot.validate(duplicate, 40, null)).toThrow(
      "duplicate",
    );
    const broken = snapshot();
    broken.accounting.recordsProcessed++;
    expect(() => KandrSnapshot.validate(broken, 40, null)).toThrow(
      "accounting",
    );
  });
});
