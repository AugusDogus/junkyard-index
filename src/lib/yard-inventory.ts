import { VehicleEngine } from "./vehicle-engine";
import { InventoryFormat } from "./inventory-format";
import { VehicleName } from "./vehicle-name";

/** One live vehicle as shown on a yard's inventory pages. */
export type YardVehicle = {
  vin: string;
  year: number;
  make: string;
  model: string;
  sourceModel?: string | null;
  trim: string | null;
  engine: string | null;
  color: string | null;
  stockNumber: string | null;
  section: string | null;
  row: string | null;
  space: string | null;
  /** Yard date, observed arrival, or first indexed date (ms), in that order. */
  addedAt: number;
  /** Whether the date proves arrival or only when the listing was indexed. */
  addedBy: "yard" | "observed" | "first-seen";
  imageUrl: string | null;
  detailsUrl: string | null;
};

/** Where a page of a yard's inventory starts. `page` is 1-based. */
export type YardPageRange = {
  page: number;
  pageCount: number;
  firstIndex: number;
};

/** One page of a yard's inventory. */
export type YardInventoryPage = YardPageRange & { vehicles: YardVehicle[] };

/**
 * What "new this week" needs of a list of vehicles without the vehicles:
 * how many there are, and when each known arrival came (ms). Vehicles only
 * first seen by us have no known arrival.
 */
export type YardArrivals = { total: number; knownAt: number[] };

/**
 * Everything a yard's pages need of its whole inventory, small enough to
 * cache in one entry: the count, the makes, and each make's known arrivals
 * (placeholder makes under the empty key). `fingerprint` identifies the read
 * it came from, so lists cached from other reads can be told apart.
 */
export type YardSummary = {
  fingerprint: string;
  total: number;
  makes: MakeCount[];
  arrivals: { key: string; knownAt: number[] }[];
};

/**
 * "New this week" on a yard page. `since` ends the week for both the header
 * count and the row badges. A yard that is mostly new stays `quiet`.
 */
export type YardNewArrivals =
  | { kind: "quiet" }
  | { kind: "counted"; count: number; since: string };

/** A make at one yard; `key` matches the national make page's. */
export type MakeCount = { key: string; make: string; count: number };

export const YARD_PAGE_SIZE = 100;

/**
 * Vehicles per cached slice of a yard's inventory: whole pages, so a page
 * reads one slice. 2,000 vehicles serialize to about 0.7 to 0.9 MB, under
 * the 2 MB Next.js data-cache limit that a whole large yard exceeds.
 */
export const YARD_SLICE_SIZE = 20 * YARD_PAGE_SIZE;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// Above this share of a yard's vehicles, "new" stops meaning anything.
const MOSTLY_NEW = 0.8;

function text(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / YARD_PAGE_SIZE));
}

/** cyrb53, a fast 53-bit string hash; not for security. */
function hash53(value: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function inWeek(at: number, referenceTime: string): boolean {
  return (
    at >= Date.parse(referenceTime) - WEEK_MS && at <= Date.parse(referenceTime)
  );
}

export const YardInventory = {
  /** Matches national taxonomy identities, including provider aliases. */
  forModel(
    vehicles: readonly YardVehicle[],
    makeKey: string,
    modelKey: string,
  ): YardVehicle[] {
    return vehicles.filter(
      (vehicle) =>
        VehicleName.makeKey(vehicle.make) === makeKey &&
        VehicleName.modelKey(vehicle.make, vehicle.model) === modelKey,
    );
  },
  /** Normalizes a stored vehicle row for display. */
  vehicle(row: {
    vin: string;
    year: number;
    make: string;
    model: string;
    sourceModel?: string | null;
    trim: string | null;
    engine: string | null;
    color: string | null;
    stockNumber: string | null;
    section: string | null;
    row: string | null;
    space: string | null;
    availableDate: string | null;
    firstSeenAt: number;
    observedArrivalAt: number | null;
    imageUrl: string | null;
    detailsUrl: string | null;
  }): YardVehicle {
    const { availableDate, firstSeenAt, observedArrivalAt, ...rest } = row;
    return {
      ...rest,
      make: VehicleName.makeName(rest.make),
      model: VehicleName.modelName(rest.make, rest.model),
      trim: text(rest.trim),
      engine: VehicleEngine.normalize(text(rest.engine)),
      color: text(rest.color),
      stockNumber: text(rest.stockNumber),
      section: text(rest.section),
      row: text(rest.row),
      space: text(rest.space),
      ...YardInventory.added(availableDate, firstSeenAt, observedArrivalAt),
    };
  },

  /** Yard date or observed arrival, then first indexed date (ms). */
  addedAt(
    availableDate: string | null,
    firstSeenAt: number,
    observedArrivalAt: number | null,
  ): number {
    return YardInventory.added(availableDate, firstSeenAt, observedArrivalAt)
      .addedAt;
  },

  /** `addedAt`, and whose date it is. */
  added(
    availableDate: string | null,
    firstSeenAt: number,
    observedArrivalAt: number | null,
  ): Pick<YardVehicle, "addedAt" | "addedBy"> {
    const setAt = availableDate ? Date.parse(availableDate) : Number.NaN;
    return Number.isFinite(setAt)
      ? { addedAt: setAt, addedBy: "yard" }
      : observedArrivalAt !== null
        ? { addedAt: observedArrivalAt, addedBy: "observed" }
        : { addedAt: firstSeenAt, addedBy: "first-seen" };
  },

  /** Distinguishes a yard date, observed arrival and first indexed date. */
  addedLabel(vehicle: Pick<YardVehicle, "addedAt" | "addedBy">): string {
    const date = InventoryFormat.date(vehicle.addedAt);
    return vehicle.addedBy === "yard"
      ? `In the yard since ${date}`
      : vehicle.addedBy === "observed"
        ? `Seen ${date}`
        : `First seen ${date}`;
  },

  /**
   * Whether a known arrival falls in the week ending at `referenceTime`.
   * Callers choose the clock or a publication time for cached snapshots.
   */
  isNew(
    vehicle: Pick<YardVehicle, "addedAt" | "addedBy">,
    referenceTime: string | null,
  ): boolean {
    if (referenceTime === null || vehicle.addedBy === "first-seen")
      return false;
    return inWeek(vehicle.addedAt, referenceTime);
  },

  /** How many of `vehicles` are new, as `isNew` counts them. */
  newCount(
    vehicles: readonly Pick<YardVehicle, "addedAt" | "addedBy">[],
    referenceTime: string | null,
  ): number {
    return vehicles.filter((vehicle) =>
      YardInventory.isNew(vehicle, referenceTime),
    ).length;
  },

  /**
   * Whether "new this week" means anything for a yard. A yard we just
   * started tracking, with no set dates of its own, has every vehicle first
   * seen this week; flagging them all would say nothing.
   */
  newIsMeaningful(newCount: number, total: number): boolean {
    return newCount <= total * MOSTLY_NEW;
  },

  /**
   * New arrivals among `vehicles` in the week ending at `referenceTime`, the
   * render's clock, as the linked arrival search measures. Whether "new"
   * means anything is judged from `yardVehicles`, the whole yard, so one new
   * Honda at a long-tracked yard is news even on its Honda page.
   */
  newArrivals(
    vehicles: readonly Pick<YardVehicle, "addedAt" | "addedBy">[],
    yardVehicles: readonly Pick<YardVehicle, "addedAt" | "addedBy">[],
    referenceTime: string,
  ): YardNewArrivals {
    return YardInventory.newArrivalsFrom(
      YardInventory.arrivals(vehicles),
      YardInventory.arrivals(yardVehicles),
      referenceTime,
    );
  },

  /** `newArrivals` from the vehicles' arrivals instead of the vehicles. */
  newArrivalsFrom(
    shown: YardArrivals,
    yard: YardArrivals,
    referenceTime: string,
  ): YardNewArrivals {
    const newIn = ({ knownAt }: YardArrivals) =>
      knownAt.filter((at) => inWeek(at, referenceTime)).length;
    if (!YardInventory.newIsMeaningful(newIn(yard), yard.total))
      return { kind: "quiet" };
    return { kind: "counted", count: newIn(shown), since: referenceTime };
  },

  /** The known arrivals among `vehicles`. */
  arrivals(
    vehicles: readonly Pick<YardVehicle, "addedAt" | "addedBy">[],
  ): YardArrivals {
    return {
      total: vehicles.length,
      knownAt: vehicles.flatMap((vehicle) =>
        vehicle.addedBy === "first-seen" ? [] : [vehicle.addedAt],
      ),
    };
  },

  /**
   * Identifies a read of a yard's whole inventory: its vehicles in order, and
   * the make and arrival a summary counts for each.
   */
  fingerprint(vehicles: readonly YardVehicle[]): string {
    return `${vehicles.length}:${hash53(
      vehicles
        .map(
          (vehicle) =>
            `${vehicle.vin}\u0000${vehicle.make}\u0000${vehicle.addedAt}\u0000${vehicle.addedBy}`,
        )
        .join("\u0001"),
    )}`;
  },

  /** A yard's summary, from its whole inventory. */
  summary(vehicles: readonly YardVehicle[]): YardSummary {
    const arrivals = new Map<string, number[]>();
    for (const vehicle of vehicles) {
      if (vehicle.addedBy === "first-seen") continue;
      const key = VehicleName.makeKey(vehicle.make) ?? "";
      const knownAt = arrivals.get(key) ?? [];
      knownAt.push(vehicle.addedAt);
      arrivals.set(key, knownAt);
    }
    return {
      fingerprint: YardInventory.fingerprint(vehicles),
      total: vehicles.length,
      makes: YardInventory.makeCounts(vehicles),
      arrivals: [...arrivals].map(([key, knownAt]) => ({ key, knownAt })),
    };
  },

  /** The whole yard's arrivals, from its summary. */
  yardArrivals(summary: YardSummary): YardArrivals {
    return {
      total: summary.total,
      knownAt: summary.arrivals.flatMap(({ knownAt }) => knownAt),
    };
  },

  /** One make's arrivals at a yard, by make key, from its summary. */
  makeArrivals(summary: YardSummary, makeKey: string): YardArrivals {
    return {
      total: summary.makes.find((make) => make.key === makeKey)?.count ?? 0,
      knownAt:
        summary.arrivals.find((make) => make.key === makeKey)?.knownAt ?? [],
    };
  },

  /**
   * What a yard page shows of `newArrivals`: the header's "N new this week"
   * count, or null to say nothing, and the week's end for row badges, or null
   * for none. Both come from `since`, the render's clock, never the snapshot's
   * publication time, so the badges match the count. A newly tracked yard is
   * all "new"; it shows neither.
   */
  newDisplay(newArrivals: YardNewArrivals): {
    headerCount: number | null;
    badgesSince: string | null;
  } {
    if (newArrivals.kind === "quiet")
      return { headerCount: null, badgesSince: null };
    return {
      headerCount: newArrivals.count > 0 ? newArrivals.count : null,
      badgesSince: newArrivals.since,
    };
  },

  /** Newest first; VIN breaks ties so pages are stable between renders. */
  sort<Vehicle extends YardVehicle>(vehicles: readonly Vehicle[]): Vehicle[] {
    return [...vehicles].sort(
      (a, b) =>
        b.addedAt - a.addedAt || (a.vin < b.vin ? -1 : a.vin > b.vin ? 1 : 0),
    );
  },

  pageCount,

  /** Where page `page` of `total` vehicles starts, or null past the last. */
  pageRange(total: number, page: number): YardPageRange | null {
    const count = pageCount(total);
    if (!Number.isInteger(page) || page < 1 || page > count) return null;
    return { page, pageCount: count, firstIndex: (page - 1) * YARD_PAGE_SIZE };
  },

  /** The requested page, or null when it is past the last page. */
  page(
    vehicles: readonly YardVehicle[],
    page: number,
  ): YardInventoryPage | null {
    const range = YardInventory.pageRange(vehicles.length, page);
    return (
      range && {
        ...range,
        vehicles: vehicles.slice(
          range.firstIndex,
          range.firstIndex + YARD_PAGE_SIZE,
        ),
      }
    );
  },

  /** How many slices hold `total` vehicles. */
  sliceCount(total: number): number {
    return Math.ceil(total / YARD_SLICE_SIZE);
  },

  /** Slice `index` of a list of vehicles. */
  slice(vehicles: readonly YardVehicle[], index: number): YardVehicle[] {
    return vehicles.slice(
      index * YARD_SLICE_SIZE,
      (index + 1) * YARD_SLICE_SIZE,
    );
  },

  /** The slice that holds a page. */
  sliceIndex(range: YardPageRange): number {
    return Math.floor(range.firstIndex / YARD_SLICE_SIZE);
  },

  /** A page, from slice `index`, the one `sliceIndex` gives for it. */
  pageInSlice(
    slice: readonly YardVehicle[],
    index: number,
    range: YardPageRange,
  ): YardInventoryPage {
    const offset = range.firstIndex - index * YARD_SLICE_SIZE;
    return {
      ...range,
      vehicles: slice.slice(offset, offset + YARD_PAGE_SIZE),
    };
  },

  /**
   * Live vehicles per make, most common first. Spellings of one make ("Vw",
   * "Volkswagen") count together under the preferred spelling; placeholder
   * makes such as "Other" are left out.
   */
  makeCounts(vehicles: readonly YardVehicle[]): MakeCount[] {
    const groups = new Map<string, Map<string, number>>();
    for (const { make } of vehicles) {
      const key = VehicleName.makeKey(make);
      if (!key) continue;
      const name = make.trim();
      const spellings = groups.get(key) ?? new Map<string, number>();
      spellings.set(name, (spellings.get(name) ?? 0) + 1);
      groups.set(key, spellings);
    }
    return [...groups.entries()]
      .map(([key, spellings]) => ({
        key,
        make: VehicleName.makeName(VehicleName.preferredSpelling(spellings)),
        count: [...spellings.values()].reduce((sum, n) => sum + n, 0),
      }))
      .sort((a, b) => b.count - a.count || a.make.localeCompare(b.make));
  },

  /** "Row 12, Section B, Space 4", or null when the yard gives no location. */
  location(
    vehicle: Pick<YardVehicle, "row" | "section" | "space">,
  ): string | null {
    const parts = [
      // Yards without row numbers export row 0; it is not a place to look.
      vehicle.row && !/^0+$/.test(vehicle.row) && `Row ${vehicle.row}`,
      vehicle.section && `Section ${vehicle.section}`,
      vehicle.space && `Space ${vehicle.space}`,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
  },
} as const;
