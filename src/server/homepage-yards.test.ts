import { createClient } from "@libsql/client";
import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync } from "node:fs";
import { HiddenSources } from "~/lib/hidden-source";
import { yard } from "~/schema";
import { getDormantYardCandidates, getHomepageYards } from "./homepage-yards";

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

test("dormant candidates are yards hidden only by the 7-day hide and yards whose last vehicle departed", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    for (const migration of [
      "0007_yard_metadata.sql",
      "0016_yard_inventory.sql",
      "0021_yard_publication.sql",
      "0030_source_control.sql",
      "0036_departed_yard.sql",
    ]) {
      if (migration === "0016_yard_inventory.sql")
        await client.executeMultiple(`
          create table vehicle (source text, location_code text, location_name text,
            location_city text, state_abbr text, lat real, lng real, missing_since_at integer,
            details_url text);
          insert into vehicle values
            ('pyp', '1', 'Sun Valley', 'Sun Valley', 'CA', 34, -118, null, null),
            ('meeks', '1', 'Meeks Recycling', 'Martinsville', 'VA', 36, -79, null, null),
            ('row52', '7', 'Pick-n-Pull', 'Tulsa', 'OK', 36, -95, null, null);
        `);
      await client.executeMultiple(
        readFileSync(
          new URL(`../../drizzle/${migration}`, import.meta.url),
          "utf8",
        ).replaceAll("--> statement-breakpoint", ""),
      );
    }
    await client.executeMultiple(`
      update yard_inventory set last_published_at = 1000;
      insert into departed_yard values
        ('pullapart', '3', 'Montgomery', 'Montgomery', 'AL', 32, -86, null, 2000),
        ('meeks', '2', 'Meeks Two', 'Martinsville', 'VA', 36, -79, null, 3000),
        ('upullitne', '1', 'Retired Nebraska', 'Lincoln', 'NE', 40, -96, null, 4000);
    `);
    const db = drizzle(client);
    await db.insert(yard).values({
      source: "pullapart",
      code: "3",
      name: "Pull-A-Part - Montgomery",
      city: "Montgomery",
      state: "AL",
      phone: "334-555-0100",
      updatedAt: new Date(),
    });
    // pyp is past the 7-day hide; meeks is hidden by the owner as well
    // (0030_source_control hides it).
    const candidates = await getDormantYardCandidates(
      db,
      HiddenSources.of(["pyp", "meeks"]),
    );
    expect(
      candidates.map(({ source, code, dormant, vehicleCount }) => ({
        source,
        code,
        dormant,
        vehicleCount,
      })),
    ).toEqual([
      {
        source: "pyp",
        code: "1",
        dormant: { kind: "unconfirmed", since: new Date(1000).toISOString() },
        vehicleCount: 0,
      },
      {
        source: "pullapart",
        code: "3",
        dormant: { kind: "emptied", since: new Date(2000).toISOString() },
        vehicleCount: 0,
      },
    ]);
    // A departed yard keeps its metadata's name and contacts.
    expect(candidates[1]).toMatchObject({
      name: "Pull-A-Part - Montgomery",
      phone: "334-555-0100",
    });
  } finally {
    client.close();
  }
});
