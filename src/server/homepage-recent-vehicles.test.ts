import { createClient } from "@libsql/client";
import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync } from "node:fs";
import { RecentArrivals } from "~/lib/recent-arrivals";
import { getRecentHomepageVehicles } from "./homepage-recent-vehicles";

test("recent vehicles skip each yard's first crawl but keep later arrivals and existing yards", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(`
      create table vehicle (vin text primary key, source text not null,
        year integer not null, make text not null, model text not null,
        image_url text, available_date text, location_code text not null,
        location_city text not null default 'Unknown', state_abbr text not null,
        first_seen_at integer not null, missing_since_at integer);
      insert into vehicle (vin, source, year, make, model, location_code, state_abbr, first_seen_at)
        values ('A-existing', 'pyp', 2010, 'Ford', 'Focus', 'old-yard', 'CA', 1000);
    `);
    // The migration treats every yard that already has inventory as established.
    await client.executeMultiple(
      readFileSync(
        new URL(
          "../../drizzle/0017_observed_vehicle_arrival.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const firstCrawl = 5000;
    const laterCrawl = 6000;
    await client.executeMultiple(`
      insert into yard_arrival_baseline (source, location_code, established_at)
        values ('hollanderstores', 'new-yard', ${firstCrawl});
      insert into vehicle (vin, source, year, make, model, location_code, state_abbr, first_seen_at, missing_since_at) values
        ('B-backfill', 'hollanderstores', 2012, 'Honda', 'Civic', 'new-yard', 'MN', ${firstCrawl}, null),
        ('C-arrival', 'hollanderstores', 2014, 'Toyota', 'Camry', 'new-yard', 'MN', ${laterCrawl}, null),
        ('D-missing', 'hollanderstores', 2015, 'Mazda', '3', 'new-yard', 'MN', ${laterCrawl}, 7000),
        ('E-unpublished', 'kandr', 2016, 'Kia', 'Soul', 'mid-crawl', 'OH', ${laterCrawl}, null);
    `);

    const recent = await getRecentHomepageVehicles(drizzle(client));

    expect(recent.map((entry) => `${entry.make} ${entry.model}`)).toEqual([
      "Toyota Camry",
      "Ford Focus",
    ]);
    expect(recent[0]).toMatchObject({
      year: 2014,
      state: "MN",
      indexedAt: new Date(laterCrawl).toISOString(),
    });
  } finally {
    client.close();
  }
});

test("varied homepage candidates skip backfills before applying their larger limit", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(`
      create table vehicle (vin text primary key, source text not null,
        year integer not null, make text not null, model text not null,
        image_url text, location_code text not null, location_city text not null,
        state_abbr text not null, first_seen_at integer not null, missing_since_at integer);
      create table yard_arrival_baseline (source text, location_code text, established_at integer);
      insert into yard_arrival_baseline values ('pyp', 'yard', 5000);
      insert into vehicle values ('backfill', 'pyp', 2000, 'Backfill', 'Old', null, 'yard', 'City', 'CA', 5000, null);
      insert into vehicle values ('older-arrival', 'pyp', 2010, 'Honda', 'Civic', null, 'yard', 'City', 'CA', 6000, null);
    `);
    await client.batch(
      Array.from({ length: 30 }, (_, index) => ({
        sql: "insert into vehicle values (?, 'pyp', 2015, 'Ford', 'Focus', null, 'yard', 'City', 'CA', ?, null)",
        args: [`arrival-${index}`, 6001 + index],
      })),
    );
    const database = drizzle(client);
    expect(await getRecentHomepageVehicles(database)).toHaveLength(12);
    const candidates = await getRecentHomepageVehicles(database, 80);
    expect(candidates).toHaveLength(31);
    const varied = RecentArrivals.pick(candidates, 12);
    expect(varied.some((row) => row.make === "Honda")).toBe(true);
    expect(varied.some((row) => row.make === "Backfill")).toBe(false);
  } finally {
    client.close();
  }
});
