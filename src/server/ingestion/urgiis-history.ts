import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { SourcePublication } from "./source-publication";
import { UrgiisCursor } from "./urgiis-cursor";

/** Never seed a census from failed, rejected or unpublished inventory. A bad
 * previous checkpoint is deliberately returned to the connector for cold fallback. */
export async function loadUrgiisPublishedCursor(
  database: LibSQLDatabase,
): Promise<unknown> {
  const previous = await SourcePublication.latestAcceptedCursor(
    database,
    "urgiis",
  );
  if (!previous?.cursor) return null;
  try {
    return JSON.parse(previous.cursor);
  } catch {
    return previous.cursor;
  }
}

/** Keep only the newest published census Blob through staged-snapshot cleanup.
 * Once another run publishes, the old run's retained Blob becomes collectible. */
export async function urgiisPublishedStatePath(
  database: LibSQLDatabase,
): Promise<string | null> {
  const previous = await loadUrgiisPublishedCursor(database);
  try {
    const cursor = UrgiisCursor.parse(previous);
    return cursor.phase === "complete" ? cursor.statePath : null;
  } catch {
    return null;
  }
}
