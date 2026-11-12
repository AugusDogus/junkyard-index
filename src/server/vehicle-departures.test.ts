import { createClient } from "@libsql/client";
import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync } from "node:fs";
import { captureVehicleDepartures } from "./vehicle-departures";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = new Date("2026-11-10T12:00:00.000Z");
const listedAt = now.getTime() - 40 * DAY;

async function database() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    create table vehicle (
      vin text primary key, source text not null, location_code text not null,
      year integer not null, make text not null, model text not null,
      available_date text, first_seen_at integer not null,
      last_seen_at integer not null, missing_since_at integer
    );
    create index vehicle_missing_since_at_idx on vehicle (missing_since_at);
    create index vehicle_last_seen_at_idx on vehicle (last_seen_at);
    create table ingestion_run (
      id text primary key, started_at integer not null,
      commit_started_at integer, last_progress_at integer not null
    );
  `);
  await client.executeMultiple(
    readFileSync(
      new URL("../../drizzle/0017_vehicle_departure.sql", import.meta.url),
      "utf8",
    ).replaceAll("--> statement-breakpoint", ""),
  );
  const add = (vin: string, missingSinceAt: number | null) =>
    client.execute({
      sql: `insert into vehicle values (?, 'pyp', '1190', 2004, 'Honda', 'Civic', '2026-10-01', ?, ?, ?)`,
      args: [vin, listedAt, missingSinceAt ?? listedAt, missingSinceAt],
    });
  // What reconciliation does when a missing vehicle is listed again.
  const relist = (vin: string, at: number) =>
    client.execute({
      sql: "update vehicle set missing_since_at = null, last_seen_at = ? where vin = ?",
      args: [at, vin],
    });
  const miss = (vin: string, at: number) =>
    client.execute({
      sql: "update vehicle set missing_since_at = ? where vin = ?",
      args: [at, vin],
    });
  const departures = async () =>
    (
      await client.execute(
        "select vin, departed_at from vehicle_departure order by vin, departed_at",
      )
    ).rows.map((row) => [row.vin, row.departed_at]);
  return { client, db: drizzle(client), add, relist, miss, departures };
}

test("records missing vehicles once and leaves live ones", async () => {
  const { db, add, departures, client } = await database();
  try {
    const left = now.getTime() - DAY;
    await add("LIVE", null);
    await add("GONE", left);
    expect(await captureVehicleDepartures(db, now)).toEqual({
      recorded: 1,
      withdrawn: 0,
    });
    // A later capture while the vehicle is still missing adds nothing.
    expect(await captureVehicleDepartures(db, now)).toEqual({
      recorded: 0,
      withdrawn: 0,
    });
    expect(await departures()).toEqual([["GONE", left]]);
  } finally {
    client.close();
  }
});

test("withdraws the departure when the listing comes back", async () => {
  const { db, add, relist, departures, client } = await database();
  try {
    await add("BACK", now.getTime() - DAY);
    await captureVehicleDepartures(db, now);
    await relist("BACK", now.getTime() - HOUR);
    expect(await captureVehicleDepartures(db, now)).toEqual({
      recorded: 0,
      withdrawn: 1,
    });
    expect(await departures()).toEqual([]);
  } finally {
    client.close();
  }
});

test("withdraws a departure however long the listing was away", async () => {
  const { db, add, relist, departures, client } = await database();
  try {
    // The source was down for days, so the missing mark stayed old.
    await add("OUTAGE", now.getTime() - 10 * DAY);
    await captureVehicleDepartures(db, now);
    await relist("OUTAGE", now.getTime() - HOUR);
    await captureVehicleDepartures(db, now);
    expect(await departures()).toEqual([]);
  } finally {
    client.close();
  }
});

test("withdraws a departure when a resumed commit stamps the return hours earlier", async () => {
  const { db, add, relist, departures, client } = await database();
  try {
    const committedAt = now.getTime() - 6 * HOUR;
    await add("STALLED", now.getTime() - DAY);
    await captureVehicleDepartures(db, now);
    // The run claimed the commit 6 hours ago, stalled, and wrote just now.
    await client.execute({
      sql: "insert into ingestion_run values ('run', ?, ?, ?)",
      args: [committedAt - HOUR, committedAt, now.getTime() - 10 * 60 * 1000],
    });
    await relist("STALLED", committedAt);
    expect(await captureVehicleDepartures(db, now)).toEqual({
      recorded: 0,
      withdrawn: 1,
    });
    expect(await departures()).toEqual([]);
  } finally {
    client.close();
  }
});

test("withdraws a departure stamped before its run claimed the commit", async () => {
  const { db, add, relist, departures, client } = await database();
  try {
    const startedAt = now.getTime() - 6 * HOUR;
    await add("TAKEN-OVER", now.getTime() - DAY);
    await captureVehicleDepartures(db, now);
    // A local run stamped its start, then a scheduled pass claimed it late.
    await client.execute({
      sql: "insert into ingestion_run values ('run', ?, ?, ?)",
      args: [
        startedAt,
        now.getTime() - 30 * 60 * 1000,
        now.getTime() - 10 * 60 * 1000,
      ],
    });
    await relist("TAKEN-OVER", startedAt);
    expect(await captureVehicleDepartures(db, now)).toEqual({
      recorded: 0,
      withdrawn: 1,
    });
    expect(await departures()).toEqual([]);
  } finally {
    client.close();
  }
});

test("keeps only the latest departure of a listing that came back and left again", async () => {
  const { db, add, relist, miss, departures, client } = await database();
  try {
    const first = now.getTime() - 6 * HOUR;
    const second = now.getTime() - HOUR;
    await add("FLAP", first);
    await captureVehicleDepartures(db, now);
    // Between hourly captures: listed again, then missed again.
    await relist("FLAP", now.getTime() - 2 * HOUR);
    await miss("FLAP", second);
    expect(await captureVehicleDepartures(db, now)).toEqual({
      recorded: 1,
      withdrawn: 1,
    });
    expect(await departures()).toEqual([["FLAP", second]]);
  } finally {
    client.close();
  }
});

test("keeps a departure when the VIN is listed anew after deletion", async () => {
  const { db, add, departures, client } = await database();
  try {
    const left = now.getTime() - 10 * DAY;
    await add("RELISTED", left);
    await captureVehicleDepartures(db, now);
    // Ingestion deleted the old listing; the VIN appears again as a new one.
    await client.execute("delete from vehicle where vin = 'RELISTED'");
    await client.execute({
      sql: `insert into vehicle values ('RELISTED', 'pyp', '1190', 2004, 'Honda', 'Civic', null, ?, ?, null)`,
      args: [now.getTime() - HOUR, now.getTime() - HOUR],
    });
    expect(await captureVehicleDepartures(db, now)).toEqual({
      recorded: 0,
      withdrawn: 0,
    });
    expect(await departures()).toEqual([["RELISTED", left]]);
  } finally {
    client.close();
  }
});
