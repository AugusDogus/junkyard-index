import { createClient } from "@libsql/client";
import { expect, test } from "bun:test";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync } from "node:fs";
import { vehicle } from "~/schema";

// The yard make and model pages read one make's live vehicles at a yard
// (getYardMakeEntry in yard-inventory.ts). This is that query's shape.
test("one make's live vehicles at a yard are read through vehicle_yard_make_live_idx", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(`
      create table vehicle (
        vin text primary key, source text not null, location_code text not null,
        make text not null, missing_since_at integer
      );
      create index vehicle_yard_live_idx on vehicle (source, location_code, missing_since_at);
      create index vehicle_location_code_idx on vehicle (location_code);
      ${readFileSync(new URL("../../drizzle/0035_yard_make_index_and_summary.sql", import.meta.url), "utf8")}
    `);
    const database = drizzle(client);
    const query = database
      .select({ vin: vehicle.vin })
      .from(vehicle)
      .where(
        and(
          eq(vehicle.source, "pyp"),
          eq(vehicle.locationCode, "1"),
          inArray(vehicle.make, ["FORD", "Ford"]),
          isNull(vehicle.missingSinceAt),
        ),
      )
      .toSQL();
    const plan = await client.execute({
      sql: `explain query plan ${query.sql}`,
      args: query.params.map((param) =>
        typeof param === "string" || typeof param === "number" ? param : null,
      ),
    });
    expect(plan.rows.map((row) => String(row.detail)).join("\n")).toContain(
      "USING INDEX vehicle_yard_make_live_idx (source=? AND location_code=? AND make=?)",
    );
  } finally {
    client.close();
  }
});
