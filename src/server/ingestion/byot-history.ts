import { and, desc, eq, gte, ne, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionSourceRun } from "~/schema";
import { BYOT_MAX_RUN_MS, ByotCursor } from "./byot-cursor";
import { SourcePublication } from "./source-publication";

/** The latest saved checkpoint of a failed ('error' or 'partial') BYOT source
 * run since the newest success, raw as stored. A failed run that never
 * committed a chunk still holds its start cursor, so the scan passes over it
 * to the checkpoint before it. Runs that began more than `BYOT_MAX_RUN_MS`
 * before `now` are not scanned, since their evidence can no longer publish.
 * Null when a run succeeded since, or nothing qualifies. `ByotCursor.resume`
 * decides whether a retry continues it. */
export async function loadByotFailedAttemptCursor(
  database: LibSQLDatabase,
  now: number,
): Promise<string | null> {
  const runs = await database
    .select({
      id: ingestionSourceRun.id,
      status: ingestionSourceRun.status,
      saved: sql<number>`${ingestionSourceRun.nextCursor} is not null and ${ingestionSourceRun.nextCursor} <> ${ingestionSourceRun.startCursor}`,
    })
    .from(ingestionSourceRun)
    .where(
      and(
        eq(ingestionSourceRun.source, "byot"),
        ne(ingestionSourceRun.status, "running"),
        gte(ingestionSourceRun.startedAt, new Date(now - BYOT_MAX_RUN_MS)),
      ),
    )
    .orderBy(desc(ingestionSourceRun.startedAt));
  for (const run of runs) {
    if (run.status === "success") return null;
    if (!run.saved) continue;
    const [row] = await database
      .select({ cursor: ingestionSourceRun.nextCursor })
      .from(ingestionSourceRun)
      .where(eq(ingestionSourceRun.id, run.id));
    return row?.cursor ?? null;
  }
  return null;
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
