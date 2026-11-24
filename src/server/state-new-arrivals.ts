import { notInArray } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { HiddenSources } from "~/lib/hidden-source";
import { YardInventory } from "~/lib/yard-inventory";
import { stateRecentArrival } from "~/schema";

/** New arrivals per state, read from the summary ingestion maintains. */
export const StateNewArrivals = {
  /**
   * Live vehicles new in the week ending at `referenceTime`, by state
   * abbreviation, counted as `YardInventory.isNew` counts them. Leaves out
   * hidden and retired sources. States with none are absent.
   */
  async counts(
    database: LibSQLDatabase,
    hidden: HiddenSources,
    referenceTime: string,
  ): Promise<Record<string, number>> {
    const rows = await database
      .select({
        stateAbbr: stateRecentArrival.stateAbbr,
        availableDate: stateRecentArrival.availableDate,
        observedArrivalAt: stateRecentArrival.observedArrivalAt,
        vehicleCount: stateRecentArrival.vehicleCount,
      })
      .from(stateRecentArrival)
      .where(
        notInArray(stateRecentArrival.source, [
          ...HiddenSources.unlisted(hidden),
        ]),
      );
    const counts: Record<string, number> = {};
    for (const row of rows) {
      // Rows without a usable yard date or observed arrival fall back to
      // the first indexed date, which is never new, so none is stored.
      const added = YardInventory.added(
        row.availableDate,
        Number.NaN,
        row.observedArrivalAt?.getTime() ?? null,
      );
      if (!YardInventory.isNew(added, referenceTime)) continue;
      counts[row.stateAbbr] = (counts[row.stateAbbr] ?? 0) + row.vehicleCount;
    }
    return counts;
  },
} as const;
