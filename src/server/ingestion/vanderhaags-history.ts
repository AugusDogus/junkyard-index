import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionRun, ingestionSourceRun } from "~/schema";

/** Never seed a census from failed, rejected or unpublished inventory. A bad
 * previous checkpoint is deliberately returned to the connector for cold fallback. */
export async function loadVanderHaagsPublishedCursor(
  database: LibSQLDatabase,
): Promise<unknown> {
  const [previous] = await database
    .select({ cursor: ingestionSourceRun.nextCursor })
    .from(ingestionSourceRun)
    .innerJoin(ingestionRun, eq(ingestionRun.id, ingestionSourceRun.runId))
    .where(
      and(
        eq(ingestionSourceRun.source, "vanderhaags"),
        eq(ingestionSourceRun.status, "success"),
        eq(ingestionSourceRun.acceptanceStatus, "accepted"),
        isNotNull(ingestionRun.searchPublishedAt),
      ),
    )
    .orderBy(desc(ingestionRun.searchPublishedAt))
    .limit(1);
  if (!previous?.cursor) return null;
  try {
    const input: unknown = JSON.parse(previous.cursor);
    return typeof input === "object" && input !== null && !Array.isArray(input)
      ? { ...input, source: "vanderhaags" }
      : input;
  } catch {
    return previous.cursor;
  }
}
