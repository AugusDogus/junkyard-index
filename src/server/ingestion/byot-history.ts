import { and, desc, eq, ne } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionSourceRun } from "~/schema";
import { ByotCursor } from "./byot-cursor";
import { SourcePublication } from "./source-publication";

/** The last saved checkpoint of the newest finished BYOT source run, raw as
 * stored, when that run failed ('error' or 'partial'). Null when it succeeded
 * or none finished. `ByotCursor.resume` decides whether a retry continues it. */
export async function loadByotFailedAttemptCursor(
  database: LibSQLDatabase,
): Promise<string | null> {
  const [latest] = await database
    .select({
      status: ingestionSourceRun.status,
      cursor: ingestionSourceRun.nextCursor,
    })
    .from(ingestionSourceRun)
    .where(
      and(
        eq(ingestionSourceRun.source, "byot"),
        ne(ingestionSourceRun.status, "running"),
      ),
    )
    .orderBy(desc(ingestionSourceRun.startedAt))
    .limit(1);
  return latest && latest.status !== "success" ? latest.cursor : null;
}

/** Failed, partial and unpublished runs cannot seed the next daily sweep.
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
