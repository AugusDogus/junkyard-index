import { describe, expect, test } from "bun:test";
import {
  YARD_PAGE_SIZE,
  YardInventory,
  type YardVehicle,
} from "./yard-inventory";

const row = (
  overrides: Partial<Parameters<typeof YardInventory.vehicle>[0]> = {},
) => ({
  vin: "1HGCM82633A004352",
  year: 2003,
  make: "HONDA",
  model: "ACCORD",
  trim: null,
  engine: null,
  color: "Blue",
  stockNumber: "  ",
  section: null,
  row: "12",
  space: null,
  availableDate: "2026-11-01T00:00:00.000Z",
  firstSeenAt: Date.parse("2026-11-03T07:00:00.000Z"),
  imageUrl: null,
  detailsUrl: null,
  ...overrides,
});

const vehicles = (count: number): YardVehicle[] =>
  Array.from({ length: count }, (_, index) =>
    YardInventory.vehicle(
      row({ vin: `VIN${String(index).padStart(5, "0")}`, firstSeenAt: index }),
    ),
  );

describe("YardInventory.vehicle", () => {
  test("uses the yard's set date and blanks empty text", () => {
    const vehicle = YardInventory.vehicle(row());
    expect(vehicle.addedAt).toBe(Date.parse("2026-11-01T00:00:00.000Z"));
    expect(vehicle.stockNumber).toBeNull();
  });

  test("falls back to first seen when the set date does not parse", () => {
    const firstSeenAt = Date.parse("2026-11-03T07:00:00.000Z");
    expect(
      YardInventory.vehicle(row({ availableDate: "soon", firstSeenAt }))
        .addedAt,
    ).toBe(firstSeenAt);
    expect(
      YardInventory.vehicle(row({ availableDate: null, firstSeenAt })).addedAt,
    ).toBe(firstSeenAt);
  });
});

describe("YardInventory.sort", () => {
  test("puts the newest first and breaks ties by VIN", () => {
    const sorted = YardInventory.sort([
      YardInventory.vehicle(row({ vin: "B", availableDate: "2026-01-01" })),
      YardInventory.vehicle(row({ vin: "C", availableDate: "2026-03-01" })),
      YardInventory.vehicle(row({ vin: "A", availableDate: "2026-01-01" })),
    ]);
    expect(sorted.map((vehicle) => vehicle.vin)).toEqual(["C", "A", "B"]);
  });
});

describe("YardInventory.page", () => {
  test("splits inventory into fixed-size pages", () => {
    const all = vehicles(YARD_PAGE_SIZE * 2 + 5);
    const last = YardInventory.page(all, 3);
    expect(last).toMatchObject({ page: 3, pageCount: 3 });
    expect(last?.firstIndex).toBe(YARD_PAGE_SIZE * 2);
    expect(last?.vehicles).toHaveLength(5);
    expect(YardInventory.page(all, 4)).toBeNull();
    expect(YardInventory.page(all, 0)).toBeNull();
    expect(YardInventory.page(all, 1.5)).toBeNull();
  });

  test("an empty yard still has an empty first page", () => {
    expect(YardInventory.page([], 1)).toMatchObject({
      pageCount: 1,
      vehicles: [],
    });
  });
});

describe("YardInventory.makeCounts", () => {
  test("merges case variants under the mixed-case spelling", () => {
    const counts = YardInventory.makeCounts(
      ["HONDA", "Honda", "HONDA", "BMW", "Ford", "Ford", "Ford", " "].map(
        (make, index) =>
          YardInventory.vehicle(row({ vin: String(index), make })),
      ),
    );
    // Equal counts read alphabetically; all-caps spellings stay as given.
    expect(counts).toEqual([
      { make: "Ford", count: 3 },
      { make: "Honda", count: 3 },
      { make: "BMW", count: 1 },
    ]);
  });
});

describe("YardInventory.location", () => {
  test("joins the parts the yard provides", () => {
    expect(
      YardInventory.location({ row: "12", section: null, space: "4" }),
    ).toBe("Row 12, Space 4");
    expect(
      YardInventory.location({ row: null, section: null, space: null }),
    ).toBeNull();
  });
});
