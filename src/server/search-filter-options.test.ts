import { createClient } from "@libsql/client";
import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync } from "node:fs";
import { SearchFilterOptions } from "./search-filter-options";

function migration(name: string): string {
  return readFileSync(
    new URL(`../../drizzle/${name}`, import.meta.url),
    "utf8",
  );
}

test("filter options list every live make, color, state and yard from Turso", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(`
      create table vehicle (source text, location_code text, location_name text,
        location_city text, state text, state_abbr text, lat real, lng real,
        color text, missing_since_at integer, details_url text);
      insert into vehicle values
        ('pyp', '1', 'Sun Valley', 'Sun Valley', 'California', 'CA', 34, -118, 'Red', null, null),
        ('pyp', '1', 'Sun Valley', 'Sun Valley', 'California', 'CA', 34, -118, null, null, null),
        ('pullapart', '3', 'Montgomery', 'Montgomery', 'Alabama', 'AL', 32, -86, 'Blue', null,
          'https://www.pullapart.com/inventory/montgomery'),
        ('pyp', '2', 'Gone', 'Gone', 'Nevada', 'NV', 36, -115, 'Green', 1, null),
        ('upullitne', '1', 'Retired Nebraska', 'Lincoln', 'Nebraska', 'NE', 40, -96, 'Red', null, null);
    `);
    await client.executeMultiple(migration("0016_yard_inventory.sql"));
    await client.executeMultiple(migration("0020_inventory_snapshot.sql"));
    await client.execute({
      sql: "insert into inventory_snapshot (key, data, updated_at) values (?, ?, 0)",
      args: [
        "v3:make-counts",
        JSON.stringify([
          { make: "Toyota", count: 2 },
          { make: "Ford", count: 1 },
          { make: "Retired", count: 0 },
        ]),
      ],
    });

    expect(await SearchFilterOptions.load(drizzle(client))).toEqual({
      makes: ["Ford", "Toyota"],
      colors: ["Blue", "Red"],
      states: ["Alabama", "California"],
      // Yards are spelled as the search index names them. Retired sources
      // (upullitne) and departed vehicles (Nevada, Green) are left out.
      salvageYards: [
        "LKQ Pick Your Part - Sun Valley",
        "Pull-A-Part - Montgomery",
      ],
    });
  } finally {
    client.close();
  }
});

test("lists more than 500 yards, the old facet limit", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(`
      create table vehicle (source text, location_code text, location_name text,
        location_city text, state text, state_abbr text, lat real, lng real,
        color text, missing_since_at integer, details_url text);
      with recursive yard(n) as (select 1 union all select n + 1 from yard where n < 600)
      insert into vehicle
        select 'row52', n, 'Yard ' || n, 'City', 'Texas', 'TX', 30, -97, null, null, null
        from yard;
    `);
    await client.executeMultiple(migration("0016_yard_inventory.sql"));
    await client.executeMultiple(migration("0020_inventory_snapshot.sql"));
    await client.execute(
      "insert into inventory_snapshot (key, data, updated_at) values ('v3:make-counts', '[]', 0)",
    );

    const options = await SearchFilterOptions.load(drizzle(client));
    expect(options.salvageYards).toHaveLength(600);
  } finally {
    client.close();
  }
});
