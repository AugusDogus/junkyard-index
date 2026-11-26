import { createClient, type Client } from "@libsql/client";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { and, eq, inArray, isNull, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync } from "node:fs";
import { vehicle } from "~/schema";

let client: Client;

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    create table vehicle (
      vin text primary key, source text not null, location_code text not null,
      make text not null, model text not null, missing_since_at integer
    );
    create index vehicle_yard_live_idx on vehicle (source, location_code, missing_since_at);
    create index vehicle_location_code_idx on vehicle (location_code);
    create index vehicle_make_model_idx on vehicle (make, model);
    ${readFileSync(new URL("../../drizzle/0035_yard_make_index_and_summary.sql", import.meta.url), "utf8")}
  `);
});

afterEach(() => client.close());

async function plan(where: SQL | undefined): Promise<string> {
  const query = drizzle(client)
    .select({ vin: vehicle.vin })
    .from(vehicle)
    .where(where)
    .toSQL();
  const result = await client.execute({
    sql: `explain query plan ${query.sql}`,
    args: query.params.map((param) =>
      typeof param === "string" || typeof param === "number" ? param : null,
    ),
  });
  return result.rows.map((row) => String(row.detail)).join("\n");
}

// The shapes of YardVehicles.make and YardVehicles.model (yard-vehicles.ts),
// which yard make and model pages read on a cache miss.
test("one make's live vehicles at a yard are read through vehicle_yard_make_live_idx", async () => {
  expect(
    await plan(
      and(
        eq(vehicle.source, "pyp"),
        eq(vehicle.locationCode, "1"),
        inArray(vehicle.make, ["FORD", "Ford"]),
        isNull(vehicle.missingSinceAt),
      ),
    ),
  ).toContain(
    "USING INDEX vehicle_yard_make_live_idx (source=? AND location_code=? AND make=?)",
  );
});

test("one model's live vehicles at a yard are read through the same index, model included", async () => {
  expect(
    await plan(
      and(
        eq(vehicle.source, "pyp"),
        eq(vehicle.locationCode, "1"),
        inArray(vehicle.make, ["FORD", "Ford"]),
        inArray(vehicle.model, ["F-150", "F150"]),
        isNull(vehicle.missingSinceAt),
      ),
    ),
  ).toContain(
    "USING INDEX vehicle_yard_make_live_idx (source=? AND location_code=? AND make=? AND model=?)",
  );
});
