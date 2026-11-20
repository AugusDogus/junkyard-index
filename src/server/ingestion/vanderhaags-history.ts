import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { SourcePublication } from "./source-publication";

/** Never seed a census from failed, rejected or unpublished inventory. A bad
 * previous checkpoint is deliberately returned to the connector for cold fallback. */
export async function loadVanderHaagsPublishedCursor(
  database: LibSQLDatabase,
): Promise<unknown> {
  const previous = await SourcePublication.latestAcceptedCursor(
    database,
    "vanderhaags",
  );
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
