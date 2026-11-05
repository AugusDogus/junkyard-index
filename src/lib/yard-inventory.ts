/** One live vehicle as shown on a yard's inventory pages. */
export type YardVehicle = {
  vin: string;
  year: number;
  make: string;
  model: string;
  trim: string | null;
  engine: string | null;
  color: string | null;
  stockNumber: string | null;
  section: string | null;
  row: string | null;
  space: string | null;
  /** The yard's own set date when it parses, else when we first saw it (ms). */
  addedAt: number;
  imageUrl: string | null;
  detailsUrl: string | null;
};

/** One page of a yard's inventory. `page` is 1-based. */
export type YardInventoryPage = {
  page: number;
  pageCount: number;
  firstIndex: number;
  vehicles: YardVehicle[];
};

export type MakeCount = { make: string; count: number };

export const YARD_PAGE_SIZE = 100;

function text(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / YARD_PAGE_SIZE));
}

export const YardInventory = {
  /** Normalizes a stored vehicle row for display. */
  vehicle(row: {
    vin: string;
    year: number;
    make: string;
    model: string;
    trim: string | null;
    engine: string | null;
    color: string | null;
    stockNumber: string | null;
    section: string | null;
    row: string | null;
    space: string | null;
    availableDate: string | null;
    firstSeenAt: number;
    imageUrl: string | null;
    detailsUrl: string | null;
  }): YardVehicle {
    const { availableDate, firstSeenAt, ...rest } = row;
    const setAt = availableDate ? Date.parse(availableDate) : Number.NaN;
    return {
      ...rest,
      trim: text(rest.trim),
      engine: text(rest.engine),
      color: text(rest.color),
      stockNumber: text(rest.stockNumber),
      section: text(rest.section),
      row: text(rest.row),
      space: text(rest.space),
      addedAt: Number.isFinite(setAt) ? setAt : firstSeenAt,
    };
  },

  /** Newest first; VIN breaks ties so pages are stable between renders. */
  sort(vehicles: readonly YardVehicle[]): YardVehicle[] {
    return [...vehicles].sort(
      (a, b) =>
        b.addedAt - a.addedAt || (a.vin < b.vin ? -1 : a.vin > b.vin ? 1 : 0),
    );
  },

  pageCount,

  /** The requested page, or null when it is past the last page. */
  page(
    vehicles: readonly YardVehicle[],
    page: number,
  ): YardInventoryPage | null {
    const count = pageCount(vehicles.length);
    if (!Number.isInteger(page) || page < 1 || page > count) return null;
    const firstIndex = (page - 1) * YARD_PAGE_SIZE;
    return {
      page,
      pageCount: count,
      firstIndex,
      vehicles: vehicles.slice(firstIndex, firstIndex + YARD_PAGE_SIZE),
    };
  },

  /**
   * Live vehicles per make, most common first. Spellings that differ only in
   * case count together under the mixed-case spelling when one exists.
   */
  makeCounts(vehicles: readonly YardVehicle[]): MakeCount[] {
    const groups = new Map<
      string,
      { names: Map<string, number>; count: number }
    >();
    for (const { make } of vehicles) {
      const name = make.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const group = groups.get(key) ?? { names: new Map(), count: 0 };
      group.count++;
      group.names.set(name, (group.names.get(name) ?? 0) + 1);
      groups.set(key, group);
    }
    return [...groups.values()]
      .map(({ names, count }) => {
        const spellings = [...names.entries()].sort((a, b) => b[1] - a[1]);
        const mixed = spellings.find(([name]) => name !== name.toUpperCase());
        return { make: (mixed ?? spellings[0])?.[0] ?? "", count };
      })
      .sort((a, b) => b.count - a.count || a.make.localeCompare(b.make));
  },

  /** "Row 12, Section B, Space 4", or null when the yard gives no location. */
  location(
    vehicle: Pick<YardVehicle, "row" | "section" | "space">,
  ): string | null {
    const parts = [
      vehicle.row && `Row ${vehicle.row}`,
      vehicle.section && `Section ${vehicle.section}`,
      vehicle.space && `Space ${vehicle.space}`,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
  },
} as const;
