import { createClient } from "@libsql/client";
import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { loadRow52YardExclusionIds } from "./row52-yard-exclusion";

test("reloads Row52 yard exclusions from the database", async () => {
  const client = createClient({ url: ":memory:" });
  const database = drizzle(client);
  try {
    await client.execute(`
      create table row52_yard_exclusion (
        location_id integer primary key,
        reason text not null,
        created_at integer not null
      )
    `);
    await client.execute({
      sql: "insert into row52_yard_exclusion (location_id, reason, created_at) values (?, ?, ?)",
      args: [83, "Former PICK-n-PULL Tallahassee yard", Date.now()],
    });

    expect(await loadRow52YardExclusionIds(database)).toEqual(new Set([83]));

    await client.execute({
      sql: "insert into row52_yard_exclusion (location_id, reason, created_at) values (?, ?, ?)",
      args: [110, "Second retired yard", Date.now()],
    });

    expect(await loadRow52YardExclusionIds(database)).toEqual(
      new Set([83, 110]),
    );
  } finally {
    client.close();
  }
});
