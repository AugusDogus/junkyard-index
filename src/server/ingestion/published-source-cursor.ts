import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { parseDurableSourceCursor } from "./durable-cursor";
import type { DurableIngestionSource } from "./durable-source";
import { SourcePublication } from "./source-publication";

/** Terminal cursor of the source's newest accepted publication
 * (SourcePublication: inventory committed to Turso, whether or not search
 * published it). Failed, rejected and unpublished runs never seed a census. A
 * cursor the codec rejects is returned raw so the connector can warn and run a
 * cold census. */
export async function loadPublishedSourceCursor(
  database: LibSQLDatabase,
  source: DurableIngestionSource,
): Promise<unknown> {
  const previous = await SourcePublication.latestAcceptedCursor(
    database,
    source,
  );
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
