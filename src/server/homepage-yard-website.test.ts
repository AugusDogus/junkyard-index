import { createClient } from "@libsql/client";
import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync } from "node:fs";
import { getHomepageYards } from "./homepage-yards";

test("recovers a PYP yard website from active inventory before metadata is reingested", async () => {
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
        location_city text, state_abbr text, lat real, lng real, missing_since_at integer,
        details_url text);
      insert into vehicle values
        ('pyp', '1196', 'Pick Your Part - West Palm Beach', 'West Palm Beach', 'FL', 26.69, -80.17, null,
         'https://www.pyp.com/inventory/west-palm-beach-1196/2014-ford-focus/'),
        ('pyp', '1196', 'Pick Your Part - West Palm Beach', 'West Palm Beach', 'FL', 26.69, -80.17, null, null),
        ('pyp', '1196', 'Pick Your Part - West Palm Beach', 'West Palm Beach', 'FL', 26.69, -80.17, 1,
         'https://www.pyp.com/inventory/other-1/2014-ford-focus/');
    `);
    const yards = await getHomepageYards(drizzle(client));
    expect(yards).toHaveLength(1);
    expect(yards[0]).toMatchObject({
      vehicleCount: 2,
      website: {
        kind: "yard",
        href: "https://www.pyp.com/inventory/west-palm-beach-1196/",
      },
    });
  } finally {
    client.close();
  }
});
