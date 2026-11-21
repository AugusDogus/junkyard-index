import { VehicleEngine } from "./vehicle-engine";
import { InventoryFormat } from "./inventory-format";
import { VehicleName } from "./vehicle-name";

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
  /** Yard date, observed arrival, or first indexed date (ms), in that order. */
  addedAt: number;
  /** Whether the date proves arrival or only when the listing was indexed. */
  addedBy: "yard" | "observed" | "first-seen";
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
    return (
      vehicle.addedAt >= Date.parse(referenceTime) - WEEK_MS &&
      vehicle.addedAt <= Date.parse(referenceTime)
    );
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
    if (
      !YardInventory.newIsMeaningful(
        YardInventory.newCount(yardVehicles, referenceTime),
        yardVehicles.length,
      )
    )
      return { kind: "quiet" };
    return {
      kind: "counted",
      count: YardInventory.newCount(vehicles, referenceTime),
      since: referenceTime,
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
      vehicle.row && `Row ${vehicle.row}`,
      vehicle.section && `Section ${vehicle.section}`,
      vehicle.space && `Space ${vehicle.space}`,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
  },
} as const;
