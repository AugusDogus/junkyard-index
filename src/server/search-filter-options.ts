import { notInArray, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { z } from "zod";
import { RETIRED_INGESTION_SOURCES } from "~/lib/ingestion-source";
import type { InventoryFilterOptions } from "~/lib/inventory-filter-options";
import { YardName } from "~/lib/yard-name";
import { InventorySnapshot } from "~/server/inventory-snapshot";
import { yardInventory } from "~/schema";

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
 * - makes come from the stored inventory snapshot (raw `vehicle.make`);
 * - yards come from `yard_inventory`, named as the projector names them;
 * - states and colors read the vehicle table once, in table order.
 * Retired sources are left out, as on the homepage.
 * The table scan is why callers cache this with the daily inventory.
 */
async function load(database: LibSQLDatabase): Promise<InventoryFilterOptions> {
  const [makeCounts, yards, stateColors] = await Promise.all([
    InventorySnapshot.makeCounts(database),
    database
      .select({
        source: yardInventory.source,
        name: yardInventory.locationName,
        city: yardInventory.locationCity,
        inventoryUrl: yardInventory.inventoryUrl,
      })
      .from(yardInventory)
      .where(notInArray(yardInventory.source, [...RETIRED_INGESTION_SOURCES])),
    database.all(sql`
      select distinct state, color from vehicle not indexed
      where missing_since_at is null
        and source not in (${sql.join(
          RETIRED_INGESTION_SOURCES.map((source) => sql`${source}`),
          sql`, `,
        )})
    `),
  ]);
  const pairs = stateColorSchema.parse(stateColors);
  return {
    makes: sorted(
      makeCounts.filter(({ count }) => count > 0).map(({ make }) => make),
    ),
    colors: sorted(pairs.flatMap(({ color }) => (color ? [color] : []))),
    states: sorted(pairs.map(({ state }) => state)),
    salvageYards: sorted(
      yards.map((yard) =>
        YardName.resolve({
          source: yard.source,
          name: yard.name,
          city: yard.city,
          inventoryUrl: yard.inventoryUrl,
        }),
      ),
    ),
  };
}

export const SearchFilterOptions = { load } as const;
