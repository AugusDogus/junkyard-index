import { and, eq, inArray, isNull, type SQL } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { VehicleName } from "~/lib/vehicle-name";
import { YardInventory, type YardVehicle } from "~/lib/yard-inventory";
import { vehicle } from "~/schema";

/** A yard's live vehicles matching `where`, with the fields its pages show. */
function selectYardRows(database: LibSQLDatabase, where: SQL | undefined) {
  return database
    .select({
      vin: vehicle.vin,
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      sourceModel: vehicle.sourceModel,
      trim: vehicle.trim,
      engine: vehicle.engine,
      color: vehicle.color,
      stockNumber: vehicle.stockNumber,
      section: vehicle.section,
      row: vehicle.row,
      space: vehicle.space,
      availableDate: vehicle.availableDate,
      firstSeenAt: vehicle.firstSeenAt,
      observedArrivalAt: vehicle.observedArrivalAt,
      imageUrl: vehicle.imageUrl,
      detailsUrl: vehicle.detailsUrl,
    })
    .from(vehicle)
    .where(where);
}

type YardVehicleRow = Awaited<ReturnType<typeof selectYardRows>>[number];

function toYardVehicles(rows: readonly YardVehicleRow[]): YardVehicle[] {
  return YardInventory.sort(
    rows.map(({ firstSeenAt, observedArrivalAt, ...row }) =>
      YardInventory.vehicle({
        ...row,
        firstSeenAt: firstSeenAt.getTime(),
        observedArrivalAt: observedArrivalAt?.getTime() ?? null,
      }),
    ),
  );
}

/** A yard's live vehicles, newest first, and the raw makes they came with. */
export type YardVehiclesRead = { vehicles: YardVehicle[]; rawMakes: string[] };

export const YardVehicles = {
  /** Every live vehicle of a yard, newest first. Reads the whole yard. */
  async all(
    database: LibSQLDatabase,
    source: string,
    code: string,
  ): Promise<YardVehiclesRead> {
    // No ORDER BY: with it, SQLite walks vehicle_recent_idx across every
    // live vehicle in the country. Without it, an index on the yard reads
    // only this yard's rows, which sort cheaply here.
    const rows = await selectYardRows(
      database,
      and(
        eq(vehicle.locationCode, code),
        eq(vehicle.source, source),
        isNull(vehicle.missingSinceAt),
      ),
    );
    return {
      vehicles: toYardVehicles(rows),
      rawMakes: rows.map((row) => row.make),
    };
  },

  /**
   * One make's live vehicles at a yard, newest first, read by its raw
   * `vehicle.make` spellings through vehicle_yard_make_live_idx: only the
   * rows of that make.
   */
  async make(
    database: LibSQLDatabase,
    source: string,
    code: string,
    makeKey: string,
    spellings: readonly string[],
  ): Promise<YardVehicle[]> {
    if (spellings.length === 0) return [];
    const rows = await selectYardRows(
      database,
      and(
        eq(vehicle.source, source),
        eq(vehicle.locationCode, code),
        inArray(vehicle.make, [...spellings]),
        isNull(vehicle.missingSinceAt),
      ),
    );
    return toYardVehicles(rows).filter(
      (entry) => VehicleName.makeKey(entry.make) === makeKey,
    );
  },
} as const;
