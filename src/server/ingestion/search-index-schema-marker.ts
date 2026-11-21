import { eq, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { searchIndexSchema } from "~/schema";

/**
 * The search schema version an index's migration finished, kept in Turso.
 * The Algolia `userData` marker gates readers; this copy lets ingestion pick
 * vehicle identities from Turso alone, so a blocked or frozen Algolia index
 * cannot change what reconciliation writes.
 */
export const SearchIndexSchemaMarker = {
  /** The recorded version, or 0 before any migration recorded one. */
  async version(database: LibSQLDatabase, indexName: string): Promise<number> {
    const [row] = await database
      .select({ version: searchIndexSchema.version })
      .from(searchIndexSchema)
      .where(eq(searchIndexSchema.indexName, indexName))
      .limit(1);
    return row?.version ?? 0;
  },

  /** Records `version` for `indexName`; a lower version never replaces a higher one. */
  async record(
    database: LibSQLDatabase,
    indexName: string,
    version: number,
  ): Promise<void> {
    await database
      .insert(searchIndexSchema)
      .values({ indexName, version, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: searchIndexSchema.indexName,
        set: {
          version: sql`max(${searchIndexSchema.version}, excluded.version)`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  },
} as const;
