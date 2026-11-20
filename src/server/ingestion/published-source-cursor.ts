import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionRun, ingestionSourceRun } from "~/schema";
import { parseDurableSourceCursor } from "./durable-cursor";
import type { DurableIngestionSource } from "./durable-source";

/** Terminal cursor of the newest accepted, search-published run for a source.
 * Failed, rejected and unpublished runs never seed a census. A cursor the codec
 * rejects is returned raw so the connector can warn and run a cold census. */
export async function loadPublishedSourceCursor(
  database: LibSQLDatabase,
  source: DurableIngestionSource,
): Promise<unknown> {
  const [previous] = await database
    .select({ cursor: ingestionSourceRun.nextCursor })
    .from(ingestionSourceRun)
    .innerJoin(ingestionRun, eq(ingestionRun.id, ingestionSourceRun.runId))
    .where(
      and(
        eq(ingestionSourceRun.source, source),
        eq(ingestionSourceRun.status, "success"),
        eq(ingestionSourceRun.acceptanceStatus, "accepted"),
        isNotNull(ingestionRun.searchPublishedAt),
      ),
    )
    .orderBy(desc(ingestionRun.searchPublishedAt))
    .limit(1);
  if (!previous?.cursor) return null;
  // Decode through the source's durable codec, which restores fields such as
  // `source` that some codecs strip from the wire.
  try {
    return parseDurableSourceCursor(source, previous.cursor);
  } catch {
    // The connector reports an unreadable cursor and starts a cold census.
    try {
      return JSON.parse(previous.cursor);
    } catch {
      return previous.cursor;
    }
  }
}
