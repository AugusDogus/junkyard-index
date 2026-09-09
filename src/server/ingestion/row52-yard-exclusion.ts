import { Effect } from "effect";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { row52YardExclusion } from "~/schema";
import { Database } from "./context";
import { PersistenceError } from "./errors";

export async function loadRow52YardExclusionIds(
  database: LibSQLDatabase,
): Promise<ReadonlySet<number>> {
  const rows = await database
    .select({ locationId: row52YardExclusion.locationId })
    .from(row52YardExclusion);
  return new Set(rows.map(({ locationId }) => locationId));
}

export function loadConfiguredRow52YardExclusionIds(): Effect.Effect<
  ReadonlySet<number>,
  PersistenceError,
  Database
> {
  return Effect.gen(function* () {
    const database = yield* Database;
    return yield* Effect.tryPromise({
      try: () => loadRow52YardExclusionIds(database),
      catch: (cause) =>
        new PersistenceError({
          operation: "row52YardExclusion.select",
          cause,
        }),
    });
  });
}
