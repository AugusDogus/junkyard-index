import { createClient } from "@libsql/client";
import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync } from "node:fs";
import { HiddenSources } from "~/lib/hidden-source";
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
        ('upullitne', '1', 'Retired Nebraska', 'Lincoln', 'NE', 40, -96, null),
        ('brandywine', '1', 'Retired Yard', 'City', 'MD', 39, -76, null),
        ('row52', '1', 'Independent Yard', 'Tulsa', 'OK', 36, -95, null),
        ('pullapart', '3', 'Montgomery', 'Montgomery', 'AL', 32, -86, null);
      alter table vehicle add column details_url text;
    `);
    // The migration builds yard_inventory from these vehicles.
    await client.executeMultiple(
      readFileSync(
        new URL("../../drizzle/0016_yard_inventory.sql", import.meta.url),
        "utf8",
      ),
    );
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
    const yards = await getHomepageYards(db, HiddenSources.none);
    expect(yards).toHaveLength(3);
    expect(
      yards.some(
        (yard) => yard.source === "upullitne" || yard.source === "brandywine",
      ),
    ).toBe(false);
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
    // Paths come from the metadata name, so legacy names don't leak into URLs.
    expect(yards.find((entry) => entry.source === "pyp")?.path?.href).toBe(
      "/junkyards/california/pick-your-part-sun-valley",
    );
    expect(
      yards.find((entry) => entry.source === "pullapart")?.path,
    ).toMatchObject({
      href: "/junkyards/alabama/pull-a-part-u-pull-and-pay-montgomery",
    });
  } finally {
    client.close();
  }
});

for (const source of ["meeks"] as const)
  test(`${source} is hidden, so the directory and every yard page leave it out`, async () => {
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
          ('pyp', '1', 'Sun Valley', 'Sun Valley', 'CA', 34, -118, null),
          ('${source}', '1', 'Hidden Yard', 'Martinsville', 'VA', 36, -79, null);
        alter table vehicle add column details_url text;
      `);
      await client.executeMultiple(
        readFileSync(
          new URL("../../drizzle/0016_yard_inventory.sql", import.meta.url),
          "utf8",
        ),
      );
      const yards = await getHomepageYards(
        drizzle(client),
        HiddenSources.of([source]),
      );
      expect(yards.map((entry) => entry.source)).toEqual(["pyp"]);
    } finally {
      client.close();
    }
  });

test("with meeks hidden, no yard is meeks's and no website points to meeksrecycling.com", async () => {
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
        ('pyp', '1', 'Sun Valley', 'Sun Valley', 'CA', 34, -118, null),
        ('meeks', '1', 'Meeks Recycling', 'Martinsville', 'VA', 36, -79, null);
      alter table vehicle add column details_url text;
    `);
    await client.executeMultiple(
      readFileSync(
        new URL("../../drizzle/0016_yard_inventory.sql", import.meta.url),
        "utf8",
      ),
    );
    const db = drizzle(client);
    await db.insert(yard).values({
      source: "meeks",
      code: "1",
      name: "Meeks Recycling",
      city: "Martinsville",
      state: "VA",
      websiteUrl: "https://www.meeksrecycling.com/",
      updatedAt: new Date(),
    });
    const exposesMeeks = (
      yards: Awaited<ReturnType<typeof getHomepageYards>>,
    ) =>
      yards.some(
        (entry) =>
          entry.source === "meeks" ||
          (entry.website?.href.includes("meeksrecycling.com") ?? false),
      );
    // Shown, its yard and website are listed, so the check below can fail.
    expect(exposesMeeks(await getHomepageYards(db, HiddenSources.none))).toBe(
      true,
    );
    const hidden = await getHomepageYards(db, HiddenSources.of(["meeks"]));
    expect(exposesMeeks(hidden)).toBe(false);
    expect(hidden.map((entry) => entry.source)).toEqual(["pyp"]);
  } finally {
    client.close();
  }
});
