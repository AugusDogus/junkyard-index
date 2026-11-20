import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ByotCursor } from "./byot-cursor";
import { SourcePublication } from "./source-publication";

/** Failed, partial and unpublished runs cannot advance the weekly sweep.
 * The terminal cursor survives snapshot cleanup in ingestion_source_run. */
export async function loadByotPublishedCursor(
  database: LibSQLDatabase,
): Promise<ByotCursor | null> {
  const previous = await SourcePublication.latestAcceptedCursor(
    database,
    "byot",
  );
  if (!previous) return null;
  if (!previous.cursor)
    throw new Error(
      "Published BYOT sweep has no terminal cursor. Restore its checkpoint before retrying; previous inventory remains published.",
    );
  const parsed = ByotCursor.fromWire(previous.cursor);
  if (!parsed.ok) throw new Error(parsed.error.message);
  if (parsed.value.phase !== "complete")
    throw new Error(
      "Published BYOT sweep is not terminal. Restore its checkpoint before retrying; previous inventory remains published.",
    );
  return parsed.value;
}
