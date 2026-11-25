import { and, eq, getTableColumns, notInArray, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { z } from "zod";
import { HiddenSources } from "~/lib/hidden-source";
import type { InventoryFilterOptions } from "~/lib/inventory-filter-options";
import { getYardDetails } from "~/lib/yard-details";
import { normalizeCanonicalMake } from "~/server/ingestion/normalization";
import { InventorySnapshot } from "~/server/inventory-snapshot";
import { yardInventory, yard as yardTable } from "~/schema";

const stateColorSchema = z.array(
  z.object({ state: z.string(), color: z.string().nullable() }),
);

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].filter((value) => value.length > 0).sort();
}

/**
 * Every make, color, state and yard in live inventory, read from Turso rather
 * than an Algolia facet query, so loading filters spends no search quota and
 * is not cut off at a facet value limit. Values are spelled as the search
 * index stores them, so each one refines search exactly:
 * - makes come from the stored inventory snapshot, which groups raw
 *   `vehicle.make`, normalized as the index projection normalizes them;
 * - yards come from `yard_inventory` and `yard` metadata, named with
 *   `getYardDetails` as `projectSearchVehicles` names them;
 * - states and colors come from the stored snapshot too, which the same
 *   projection pass fills; a snapshot stored before it held them makes this
 *   read the vehicle table once, in table order, until the next projection.
 * Retired and hidden sources are left out, as on the homepage.
 */
/** States and colors from one read of every vehicle, in table order. */
async function scanFilterValues(
  database: LibSQLDatabase,
  hidden: HiddenSources,
): Promise<{ states: string[]; colors: string[] }> {
  const pairs = stateColorSchema.parse(
    await database.all(sql`
      select distinct state, color from vehicle not indexed
      where missing_since_at is null
        and source not in (${sql.join(
          HiddenSources.unlisted(hidden).map((source) => sql`${source}`),
          sql`, `,
        )})
    `),
  );
  return {
    states: pairs.map(({ state }) => state),
    colors: pairs.flatMap(({ color }) => (color ? [color] : [])),
  };
}

async function load(
  database: LibSQLDatabase,
  hidden: HiddenSources,
): Promise<InventoryFilterOptions> {
  const [makeCounts, yards, filterValues] = await Promise.all([
    InventorySnapshot.makeCounts(database, hidden),
    database
      .select({
        source: yardInventory.source,
        code: yardInventory.locationCode,
        name: yardInventory.locationName,
        city: yardInventory.locationCity,
        state: yardInventory.stateAbbr,
        lat: yardInventory.lat,
        lng: yardInventory.lng,
        inventoryUrl: yardInventory.inventoryUrl,
        metadata: getTableColumns(yardTable),
      })
      .from(yardInventory)
      .leftJoin(
        yardTable,
        and(
          eq(yardTable.source, yardInventory.source),
          eq(yardTable.code, yardInventory.locationCode),
        ),
      )
      .where(
        notInArray(yardInventory.source, [...HiddenSources.unlisted(hidden)]),
      ),
    InventorySnapshot.filterValues(database, hidden).then(
      (stored) => stored ?? scanFilterValues(database, hidden),
    ),
  ]);
  return {
    makes: sorted(
      makeCounts
        .filter(({ count }) => count > 0)
        .map(({ make }) => normalizeCanonicalMake(make)),
    ),
    colors: sorted(filterValues.colors),
    states: sorted(filterValues.states),
    salvageYards: sorted(
      yards.map(({ metadata, ...yard }) => getYardDetails(yard, metadata).name),
    ),
  };
}

export const SearchFilterOptions = { load } as const;
