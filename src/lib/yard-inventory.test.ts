import { describe, expect, test } from "bun:test";
import {
  YARD_PAGE_SIZE,
  YARD_SLICE_SIZE,
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
  observedArrivalAt: null,
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

  test("says whose date it is", () => {
    const firstSeenAt = Date.parse("2026-11-03T07:00:00.000Z");
    const setByYard = YardInventory.vehicle(row());
    const seenByUs = YardInventory.vehicle(
      row({ availableDate: null, firstSeenAt }),
    );
    expect(setByYard.addedBy).toBe("yard");
    expect(YardInventory.addedLabel(setByYard)).toBe(
      "In the yard since Nov 1, 2026",
    );
    expect(seenByUs.addedBy).toBe("first-seen");
    expect(YardInventory.addedLabel(seenByUs)).toBe("First seen Nov 3, 2026");
  });
});

describe("YardInventory.isNew", () => {
  const publishedAt = "2026-11-10T12:00:00.000Z";
  const at = (iso: string): Pick<YardVehicle, "addedAt" | "addedBy"> => ({
    addedAt: Date.parse(iso),
    addedBy: "yard",
  });

  test("an undated first-crawl backlog is not a new arrival", () => {
    const vehicle = YardInventory.vehicle(
      row({
        availableDate: null,
        firstSeenAt: Date.parse("2026-11-09T00:00:00Z"),
      }),
    );
    expect(YardInventory.isNew(vehicle, publishedAt)).toBe(false);
  });

  test("an observed arrival is new even when the listing was first tracked earlier", () => {
    const vehicle = YardInventory.vehicle(
      row({
        availableDate: null,
        firstSeenAt: Date.parse("2026-01-01T00:00:00Z"),
        observedArrivalAt: Date.parse("2026-11-09T00:00:00Z"),
      }),
    );
    expect(vehicle.addedAt).toBe(Date.parse("2026-11-09T00:00:00Z"));
    expect(YardInventory.isNew(vehicle, publishedAt)).toBe(true);
    expect(YardInventory.addedLabel(vehicle)).toBe("Seen Nov 9, 2026");
  });

  test("counts the week before the yard's latest update", () => {
    expect(
      YardInventory.isNew(at("2026-11-04T00:00:00.000Z"), publishedAt),
    ).toBe(true);
    expect(
      YardInventory.isNew(at("2026-11-02T00:00:00.000Z"), publishedAt),
    ).toBe(false);
  });

  test("is meaningful unless most of the yard is new", () => {
    expect(YardInventory.newIsMeaningful(12, 677)).toBe(true);
    expect(YardInventory.newIsMeaningful(677, 677)).toBe(false);
    expect(YardInventory.newIsMeaningful(0, 0)).toBe(true);
  });

  test("calls nothing new when the yard's inventory is stale", () => {
    expect(YardInventory.isNew(at("2026-11-09T00:00:00.000Z"), null)).toBe(
      false,
    );
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
  test("merges spellings of a make and drops placeholders", () => {
    const counts = YardInventory.makeCounts(
      [
        "HONDA",
        "Honda",
        "HONDA",
        "BMW",
        "Ford",
        "Ford",
        "Ford",
        " ",
        "Other",
        "Vw",
        "Volkswagen",
      ].map((make, index) =>
        YardInventory.vehicle(row({ vin: String(index), make })),
      ),
    );
    // Equal counts read alphabetically; all-caps spellings stay as given.
    expect(counts).toEqual([
      { key: "FORD", make: "Ford", count: 3 },
      { key: "HONDA", make: "Honda", count: 3 },
      { key: "VOLKSWAGEN", make: "Volkswagen", count: 2 },
      { key: "BMW", make: "BMW", count: 1 },
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

  test("leaves out a row the yard lists as 0", () => {
    expect(
      YardInventory.location({ row: "0", section: null, space: null }),
    ).toBeNull();
    expect(
      YardInventory.location({ row: "00", section: "B", space: null }),
    ).toBe("Section B");
  });
});

test("model-scoped yard inventory preserves make and model identities", () => {
  const civic = YardInventory.vehicle(row({ model: "CIVIC" }));
  const repeated = YardInventory.vehicle(row({ model: "HONDA CIVIC" }));
  const accord = YardInventory.vehicle(row());
  const otherMake = YardInventory.vehicle(
    row({ make: "FORD", model: "CIVIC" }),
  );
  expect(
    YardInventory.forModel(
      [civic, repeated, accord, otherMake],
      "HONDA",
      "CIVIC",
    ),
  ).toEqual([civic, repeated]);
});

test("weekly entry counts include dated and observed arrivals, excluding unknown and future dates", () => {
  const now = "2026-11-19T12:00:00Z";
  const rows = [
    row({ availableDate: "2026-11-18" }),
    row({ availableDate: null, observedArrivalAt: Date.parse("2026-11-17") }),
    row({ availableDate: null, observedArrivalAt: null }),
    row({ availableDate: "2026-11-20" }),
    row({ availableDate: "2026-11-01" }),
  ].map(YardInventory.vehicle);
  expect(YardInventory.newCount(rows, now)).toBe(2);
});

test("yard pages count and badge new arrivals from one reference time", () => {
  const now = "2026-11-19T12:00:00Z";
  const recent = YardInventory.vehicle(row({ availableDate: "2026-11-18" }));
  // New by the week before an older publication, but not by the clock.
  const stale = YardInventory.vehicle(row({ availableDate: "2026-11-05" }));
  const old = YardInventory.vehicle(row({ availableDate: "2026-10-01" }));
  const yard = [recent, stale, old, old, old];
  expect(YardInventory.newArrivals([recent, stale], yard, now)).toEqual({
    kind: "counted",
    count: 1,
    since: now,
  });
});

test("a yard whose vehicles are mostly new does not count new arrivals", () => {
  const now = "2026-11-19T12:00:00Z";
  const recent = YardInventory.vehicle(row({ availableDate: "2026-11-18" }));
  const old = YardInventory.vehicle(row({ availableDate: "2026-10-01" }));
  // Judged from the whole yard, even on a page for one make.
  expect(
    YardInventory.newArrivals(
      [old],
      [recent, recent, recent, recent, recent],
      now,
    ),
  ).toEqual({ kind: "quiet" });
  expect(YardInventory.newArrivals([recent], [recent, old, old], now)).toEqual({
    kind: "counted",
    count: 1,
    since: now,
  });
});

describe("YardInventory.newDisplay", () => {
  const now = "2026-11-19T12:00:00Z";
  const recent = YardInventory.vehicle(row({ availableDate: "2026-11-18" }));
  // New in the week before an older publication, but not by the clock.
  const stale = YardInventory.vehicle(row({ availableDate: "2026-11-05" }));
  const old = YardInventory.vehicle(row({ availableDate: "2026-10-01" }));

  test("badges rows against the same time the header counts against", () => {
    const shown = [recent, stale];
    const display = YardInventory.newDisplay(
      YardInventory.newArrivals(shown, [...shown, old, old, old], now),
    );
    expect(display).toEqual({ headerCount: 1, badgesSince: now });
    const badged = shown.filter((vehicle) =>
      YardInventory.isNew(vehicle, display.badgesSince),
    );
    expect(badged).toEqual([recent]);
  });

  test("hides the header but keeps badging when none of the shown are new", () => {
    expect(
      YardInventory.newDisplay(
        YardInventory.newArrivals([old], [recent, old, old], now),
      ),
    ).toEqual({ headerCount: null, badgesSince: now });
  });

  test("shows neither at a mostly new yard", () => {
    expect(
      YardInventory.newDisplay(
        YardInventory.newArrivals([recent], [recent, recent, recent], now),
      ),
    ).toEqual({ headerCount: null, badgesSince: null });
  });
});

describe("YardInventory.summary", () => {
  const now = "2026-11-19T12:00:00Z";
  const make = (vin: string, name: string, availableDate: string | null) =>
    YardInventory.vehicle(
      row({ vin, make: name, availableDate, observedArrivalAt: null }),
    );
  const yard = YardInventory.sort([
    make("A", "HONDA", "2026-11-18"),
    make("B", "Honda", "2026-10-01"),
    make("C", "FORD", null),
    make("D", "Other", "2026-11-17"),
    make("E", "FORD", "2026-10-02"),
    // Only first seen this week: no known arrival, so never new.
    YardInventory.vehicle(
      row({
        vin: "F",
        availableDate: null,
        observedArrivalAt: null,
        firstSeenAt: Date.parse("2026-11-18T00:00:00Z"),
      }),
    ),
  ]);

  test("counts makes and new arrivals as the whole list does", () => {
    const summary = YardInventory.summary(yard);
    expect(summary.total).toBe(6);
    expect(summary.makes).toEqual(YardInventory.makeCounts(yard));
    const counted = YardInventory.newArrivalsFrom(
      YardInventory.yardArrivals(summary),
      YardInventory.yardArrivals(summary),
      now,
    );
    expect(counted).toEqual({ kind: "counted", count: 2, since: now });
    expect(counted).toEqual(YardInventory.newArrivals(yard, yard, now));
  });

  test("counts one make's new arrivals against the whole yard", () => {
    const summary = YardInventory.summary(yard);
    const hondas = yard.filter((vehicle) => vehicle.make === "Honda");
    const counted = YardInventory.newArrivalsFrom(
      YardInventory.makeArrivals(summary, "HONDA"),
      YardInventory.yardArrivals(summary),
      now,
    );
    expect(counted).toEqual({ kind: "counted", count: 1, since: now });
    expect(counted).toEqual(YardInventory.newArrivals(hondas, yard, now));
    expect(YardInventory.makeArrivals(summary, "HONDA").total).toBe(3);
    expect(YardInventory.makeArrivals(summary, "TESLA")).toEqual({
      total: 0,
      knownAt: [],
    });
  });

  test("fingerprints the read, so lists from another read of the same size differ", () => {
    const summary = YardInventory.summary(yard);
    expect(summary.fingerprint).toBe(YardInventory.fingerprint([...yard]));
    const swapped = yard.map((vehicle) =>
      vehicle.vin === "A" ? make("G", "HONDA", "2026-11-18") : vehicle,
    );
    const redated = yard.map((vehicle) =>
      vehicle.vin === "A"
        ? { ...vehicle, addedAt: vehicle.addedAt + 1 }
        : vehicle,
    );
    const renamed = yard.map((vehicle) =>
      vehicle.vin === "A" ? { ...vehicle, make: "Acura" } : vehicle,
    );
    for (const other of [swapped, redated, renamed]) {
      expect(other).toHaveLength(yard.length);
      expect(YardInventory.fingerprint(other)).not.toBe(summary.fingerprint);
    }
  });
});

describe("YardInventory slices", () => {
  test("hold whole pages, so a page reads one slice", () => {
    expect(YARD_SLICE_SIZE % YARD_PAGE_SIZE).toBe(0);
    const total = YARD_SLICE_SIZE * 2 + 150;
    const all = vehicles(total);
    expect(YardInventory.sliceCount(total)).toBe(3);
    expect(YardInventory.sliceCount(0)).toBe(0);
    const slices = Array.from({ length: 3 }, (_, index) =>
      YardInventory.slice(all, index),
    );
    expect(slices.flat()).toEqual(all);

    const lastPage = YardInventory.pageCount(total);
    for (const page of [1, YARD_SLICE_SIZE / YARD_PAGE_SIZE + 1, lastPage]) {
      const range = YardInventory.pageRange(total, page);
      if (!range) throw new Error(`page ${page} of ${total} has no range`);
      const index = YardInventory.sliceIndex(range);
      const expected = YardInventory.page(all, page);
      if (!expected) throw new Error(`page ${page} of ${total} is missing`);
      expect(
        YardInventory.pageInSlice(slices[index] ?? [], index, range),
      ).toEqual(expected);
    }
    expect(YardInventory.pageRange(total, lastPage + 1)).toBeNull();
    expect(YardInventory.pageRange(0, 1)).toEqual({
      page: 1,
      pageCount: 1,
      firstIndex: 0,
    });
  });
});
