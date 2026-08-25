import { sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

export async function transferAnonymousSearchUsage(input: {
  database: LibSQLDatabase;
  anonymousUserId: string;
  newUserId: string;
}): Promise<void> {
  await input.database.run(sql`
    insert into search_usage (user_id, day, count, updated_at)
    select ${input.newUserId}, day, count, updated_at
    from search_usage
    where user_id = ${input.anonymousUserId}
    on conflict(user_id, day) do update set
      count = search_usage.count + excluded.count,
      updated_at = excluded.updated_at
  `);
}
