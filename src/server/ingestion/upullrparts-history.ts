import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { vehicle } from "~/schema";
import { SourcePublication } from "./source-publication";
import {
  upullRPartsLocationOfStore,
  UpullRPartsDay,
  type UpullRPartsLocation,
} from "./upullrparts-date-crawl";

/** The most vehicles one location has set out on one day (November 2026). */
export const UPULLRPARTS_MAX_DAY_ARRIVALS = 64;

/** What the published snapshot already knows about a VIN. */
export interface UpullRPartsKnownVehicle {
  make: string;
  stockNumber: string | null;
  imageUrl: string | null;
}

/**
 * U Pull R Parts' published inventory, as yesterday's accepted run left it:
 * what plans the crawl's date windows and spares it a make lookup and photo
 * request for every vehicle it already knows.
 */
export interface UpullRPartsHistory {
  /** Live vehicles per arrival day, by location. */
  counts: Readonly<Record<UpullRPartsLocation, ReadonlyMap<string, number>>>;
  /** The UTC day of the latest accepted publication, or null when there is
   * none. Arrivals from that day on may be missing from the snapshot. */
  publishedDay: string | null;
  /** Every stored U Pull R Parts vehicle, live or missing, by VIN. */
  known: ReadonlyMap<string, UpullRPartsKnownVehicle>;
}

function storeOf(locationCode: string): number {
  return Number(locationCode.replace("UPRRP-", ""));
}

export const UpullRPartsHistory = {
  empty: {
    counts: { "1": new Map(), "3": new Map() },
    publishedDay: null,
    known: new Map(),
  } satisfies UpullRPartsHistory,

  async load(database: LibSQLDatabase): Promise<UpullRPartsHistory> {
    const rows = await database
      .select({
        vin: vehicle.vin,
        make: vehicle.make,
        stockNumber: vehicle.stockNumber,
        imageUrl: vehicle.imageUrl,
        locationCode: vehicle.locationCode,
        availableDate: vehicle.availableDate,
        missingSinceAt: vehicle.missingSinceAt,
      })
      .from(vehicle)
      .where(eq(vehicle.source, "upullrparts"));
    const counts: Record<UpullRPartsLocation, Map<string, number>> = {
      "1": new Map(),
      "3": new Map(),
    };
    const known = new Map<string, UpullRPartsKnownVehicle>();
    for (const row of rows) {
      known.set(row.vin, {
        make: row.make,
        stockNumber: row.stockNumber,
        imageUrl: row.imageUrl,
      });
      if (row.missingSinceAt !== null) continue;
      const location = upullRPartsLocationOfStore(storeOf(row.locationCode));
      const day = UpullRPartsDay.parse(row.availableDate?.slice(0, 10));
      if (location === null || day === null) continue;
      counts[location].set(day, (counts[location].get(day) ?? 0) + 1);
    }
    const publication = await SourcePublication.latestAccepted(
      database,
      "upullrparts",
    );
    return {
      counts,
      publishedDay:
        publication === null
          ? null
          : UpullRPartsDay.of(publication.publishedAt.getTime()),
      known,
    };
  },

  /** Vehicles a business day the snapshot has not seen is expected to add:
   * the location's busiest day in the snapshot, or the most seen anywhere. */
  newDayEstimate(
    history: UpullRPartsHistory,
    location: UpullRPartsLocation,
  ): number {
    let most = 0;
    for (const count of history.counts[location].values())
      if (count > most) most = count;
    return most > 0 ? most : UPULLRPARTS_MAX_DAY_ARRIVALS;
  },
} as const;
