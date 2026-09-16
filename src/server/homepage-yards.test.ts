import { createClient } from "@libsql/client";
import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync } from "node:fs";
import { yard } from "~/schema";
import { getHomepageYards } from "./homepage-yards";

test("directory joins metadata by source and code without changing active inventory counts", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(
      readFileSync(
        new URL("../../drizzle/0007_yard_metadata.sql", import.meta.url),
        "utf8",
      ),
    );
    await client.executeMultiple(`
      create table vehicle (source text, location_code text, location_name text,
        location_city text, state_abbr text, lat real, lng real, missing_since_at integer);
      insert into vehicle values
        ('pyp', '1', 'Raw name', 'Old city', 'CA', 34, -118, null),
        ('pyp', '1', 'Raw name', 'Old city', 'CA', 34, -118, null),
        ('pyp', '1', 'Raw name', 'Old city', 'CA', 34, -118, 1),
        ('row52', '1', 'Independent Yard', 'Tulsa', 'OK', 36, -95, null),
        ('pullapart', '3', 'Montgomery', 'Montgomery', 'AL', 32, -86, null);
      alter table vehicle add column details_url text;
    `);
    const db = drizzle(client);
    await db.insert(yard).values([
      {
        source: "pyp",
        code: "1",
        name: "Pick Your Part - Sun Valley",
        city: "Sun Valley",
        state: "CA",
        phone: "800-962-2277",
        websiteUrl: "https://www.pyp.com/inventory/sun-valley-1/",
        updatedAt: new Date(),
      },
      {
        source: "pyp",
        code: "no-cars",
        name: "Empty Yard",
        city: "City",
        state: "CA",
        updatedAt: new Date(),
      },
    ]);
    const yards = await getHomepageYards(db);
    expect(yards).toHaveLength(3);
    expect(yards.find((entry) => entry.source === "pyp")).toMatchObject({
      name: "Pick Your Part - Sun Valley",
      city: "Sun Valley",
      vehicleCount: 2,
      phone: "800-962-2277",
    });
    expect(yards.find((entry) => entry.source === "row52")).toMatchObject({
      name: "Independent Yard",
      vehicleCount: 1,
      website: null,
      phone: null,
    });
    expect(yards.find((entry) => entry.source === "pullapart")).toMatchObject({
      vehicleCount: 1,
      phone: null,
    });
  } finally {
    client.close();
  }
});
