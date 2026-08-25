import { eq, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { searchUsage } from "~/schema";

export async function transferAnonymousSearchUsage(input: {
  database: LibSQLDatabase;
  anonymousUserId: string;
  newUserId: string;
}): Promise<void> {
  const mergeUsage = input.database
    .insert(searchUsage)
    .select(
      input.database
        .select({
          userId: sql<string>`${input.newUserId}`.as("user_id"),
          day: searchUsage.day,
          count: searchUsage.count,
          updatedAt: searchUsage.updatedAt,
        })
        .from(searchUsage)
        .where(eq(searchUsage.userId, input.anonymousUserId)),
    )
    .onConflictDoUpdate({
      target: [searchUsage.userId, searchUsage.day],
      set: {
        count: sql`${searchUsage.count} + excluded.count`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
  const consumeUsage = input.database
    .delete(searchUsage)
    .where(eq(searchUsage.userId, input.anonymousUserId));

  // libSQL batches are transactional. Consuming the source rows in the same
  // write transaction makes callback retries and concurrent links idempotent.
  await input.database.batch([mergeUsage, consumeUsage]);
}
