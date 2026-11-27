import { and, eq, isNotNull } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { vehicle } from "~/schema";
import { ipullUPullPriorImageKey } from "./ipullupull-media";

/** Images currently published for iPull-uPull listings, keyed by
 * `ipullUPullPriorImageKey`. A VIN listed again under a new stock number
 * does not inherit the old listing's photo. */
export async function loadIPullUPullPublishedImages(
  database: LibSQLDatabase,
): Promise<ReadonlyMap<string, string>> {
  const rows = await database
    .select({
      vin: vehicle.vin,
      stockNumber: vehicle.stockNumber,
      imageUrl: vehicle.imageUrl,
    })
    .from(vehicle)
    .where(
      and(
        eq(vehicle.source, "ipullupull"),
        isNotNull(vehicle.stockNumber),
        isNotNull(vehicle.imageUrl),
      ),
    );
  const images = new Map<string, string>();
  for (const row of rows)
    if (row.stockNumber !== null && row.imageUrl !== null)
      images.set(
        ipullUPullPriorImageKey(row.stockNumber, row.vin),
        row.imageUrl,
      );
  return images;
}
