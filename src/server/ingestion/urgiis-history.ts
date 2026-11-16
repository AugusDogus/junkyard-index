import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionRun, ingestionSourceRun } from "~/schema";
import { UrgiisCursor } from "./urgiis-cursor";

/** Never seed a census from failed, rejected or unpublished inventory. A bad
 * previous checkpoint is deliberately returned to the connector for cold fallback. */
export async function loadUrgiisPublishedCursor(
  database: LibSQLDatabase,
): Promise<unknown> {
  const [previous] = await database
    .select({ cursor: ingestionSourceRun.nextCursor })
    .from(ingestionSourceRun)
    .innerJoin(ingestionRun, eq(ingestionRun.id, ingestionSourceRun.runId))
    .where(
      and(
        eq(ingestionSourceRun.source, "urgiis"),
        eq(ingestionSourceRun.status, "success"),
        eq(ingestionSourceRun.acceptanceStatus, "accepted"),
        isNotNull(ingestionRun.searchPublishedAt),
      ),
    )
    .orderBy(desc(ingestionRun.searchPublishedAt))
    .limit(1);
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
