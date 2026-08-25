import { sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

export const ANONYMOUS_USER_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export async function deleteExpiredAnonymousUsers(params: {
  database: LibSQLDatabase;
  now: Date;
  retentionMs?: number;
}): Promise<number> {
  const cutoff =
    params.now.getTime() - (params.retentionMs ?? ANONYMOUS_USER_RETENTION_MS);
  const result = await params.database.run(sql`
    delete from user
    where is_anonymous = 1
      and created_at < ${cutoff}
      and not exists (
        select 1
        from session
        where session.user_id = user.id
          and session.expires_at > ${params.now.getTime()}
      )
  `);
  return result.rowsAffected;
}
