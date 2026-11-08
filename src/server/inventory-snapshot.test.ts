import { createClient } from "@libsql/client";
import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync } from "node:fs";
import {
  InventorySnapshot,
  InventorySnapshotError,
} from "./inventory-snapshot";

const migration = (name: string) =>
  readFileSync(new URL(`../../drizzle/${name}.sql`, import.meta.url), "utf8")
    .split("--> statement-breakpoint")
    .join("");

async function database() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(migration("0018_inventory_snapshot"));
  await client.executeMultiple(`
    create table vehicle (
      vin text primary key, source text, location_code text, location_name text,
      location_city text, state_abbr text, lat real, lng real, details_url text,
      year integer, make text, model text, missing_since_at integer
    );
    create table ingestion_run (id text primary key, publication_sequence integer);
    create table ingestion_projector_checkpoint (
      name text primary key not null,
      last_processed_change_id integer default 0 not null,
      updated_at integer not null
    );
  `);
  const db = drizzle(client);
  const add = (
    vin: string,
    [source, code]: [string, string],
    [year, make, model]: [number, string, string],
    missingSinceAt: number | null = null,
  ) =>
    client.execute({
      sql: "insert into vehicle values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: [
        vin,
        source,
        code,
        source === "pyp" ? "Sun Valley" : "Tulsa Salvage",
        source === "pyp" ? "Sun Valley" : "Tulsa",
        source === "pyp" ? "CA" : "OK",
        source === "pyp" ? 34 : 36,
        source === "pyp" ? -118 : -95,
        `https://example.com/${source}/${code}/${vin}`,
        year,
        make,
        model,
        missingSinceAt,
      ],
    });
  const updatedAt = async (key: string) =>
    (
      await client.execute({
        sql: "select updated_at from inventory_snapshot where key = ?",
        args: [key],
      })
    ).rows[0]?.updated_at;
  return { client, db, add, updatedAt };
}

const PYP: [string, string] = ["pyp", "1"];
const ROW52: [string, string] = ["row52", "9"];
const first = new Date("2026-11-10T12:00:00.000Z");
const later = new Date("2026-11-11T12:00:00.000Z");

test("stores make counts and each make's models", async () => {
  const { client, db, add } = await database();
  try {
    await add("A", PYP, [2004, "Honda", "Civic"]);
    await add("B", PYP, [2008, "Honda", "Civic"]);
    await add("C", PYP, [2010, "HONDA", "Civic"]);
    await add("D", PYP, [2012, "Honda", "Accord"], 1);
    await add("E", ROW52, [2015, "VW", "Jetta"]);
    await add("F", ROW52, [2016, "Volkswagen", "Golf"]);
    await add("G", ROW52, [1999, "OTHER", "Trailer"]);
    await InventorySnapshot.project(db, first);

    // Every raw spelling counts, as the make list groups them itself.
    expect(
      (await InventorySnapshot.makeCounts(db)).sort((a, b) =>
        a.make.localeCompare(b.make),
      ),
    ).toEqual([
      { make: "Honda", count: 2 },
      { make: "HONDA", count: 1 },
      { make: "OTHER", count: 1 },
      { make: "Volkswagen", count: 1 },
      { make: "VW", count: 1 },
    ]);
    // One row per make key, holding every spelling; "OTHER" is not a make.
    expect(await InventorySnapshot.makeModels(db, "HONDA")).toEqual([
      {
        source: "pyp",
        code: "1",
        make: "HONDA",
        model: "Civic",
        count: 1,
        minYear: 2010,
        maxYear: 2010,
      },
      {
        source: "pyp",
        code: "1",
        make: "Honda",
        model: "Civic",
        count: 2,
        minYear: 2004,
        maxYear: 2008,
      },
    ]);
    expect(
      (await InventorySnapshot.makeModels(db, "VOLKSWAGEN")).map(
        (row) => row.model,
      ),
    ).toEqual(["Jetta", "Golf"]);
    // A make with no row has no live vehicles.
    expect(await InventorySnapshot.makeModels(db, "OTHER")).toEqual([]);
  } finally {
    client.close();
  }
});

test("rewrites only changed rows and drops makes that left inventory", async () => {
  const { client, db, add, updatedAt } = await database();
  try {
    await add("A", PYP, [2004, "Honda", "Civic"]);
    await add("B", ROW52, [2015, "VW", "Jetta"]);
    await add("C", ROW52, [2001, "Toyota", "Camry"]);
    await InventorySnapshot.project(db, first);

    await client.execute("delete from vehicle where vin = 'B'");
    await add("D", PYP, [2006, "Honda", "Civic"]);
    await InventorySnapshot.project(db, later);

    expect(await updatedAt("v1:make-models:HONDA")).toBe(later.getTime());
    expect(await updatedAt("v1:make-models:TOYOTA")).toBe(first.getTime());
    expect(await InventorySnapshot.makeModels(db, "VOLKSWAGEN")).toEqual([]);
    expect(await InventorySnapshot.makeCounts(db)).toEqual(
      expect.arrayContaining([{ make: "Honda", count: 2 }]),
    );
  } finally {
    client.close();
  }
});

test("leaves other versions' snapshots to the deployments that read them", async () => {
  const { client, db, add } = await database();
  try {
    await add("A", PYP, [2004, "Honda", "Civic"]);
    await client.executeMultiple(`
      insert into inventory_snapshot values ('v0:yards', '[]', 0);
      insert into inventory_snapshot values ('v2:make-models:FORD', '[]', 0);
      insert into inventory_snapshot values ('v1:make-models:FORD', '[]', 0);
    `);
    await InventorySnapshot.project(db, first);
    const keys = await client.execute(
      "select key from inventory_snapshot order by key",
    );
    // Only this version's departed make is dropped.
    expect(keys.rows.map((row) => row.key)).toEqual([
      "v0:yards",
      "v1:make-counts",
      "v1:make-models:HONDA",
      "v2:make-models:FORD",
    ]);
  } finally {
    client.close();
  }
});

test("records the latest publication with the snapshot, never moving it back", async () => {
  const { client, db, add } = await database();
  try {
    await add("A", PYP, [2004, "Honda", "Civic"]);
    expect(await InventorySnapshot.projectedThrough(db)).toBe(0);
    await client.executeMultiple(`
      insert into ingestion_run values ('a', 4);
      insert into ingestion_run values ('b', 7);
      insert into ingestion_run values ('c', null);
    `);
    await InventorySnapshot.project(db, first);
    expect(await InventorySnapshot.projectedThrough(db)).toBe(7);

    await client.execute("delete from ingestion_run where id = 'b'");
    await InventorySnapshot.project(db, later);
    expect(await InventorySnapshot.projectedThrough(db)).toBe(7);
  } finally {
    client.close();
  }
});

test("ensure computes the snapshot only when it is missing", async () => {
  const { client, db, add } = await database();
  try {
    await add("A", PYP, [2004, "Honda", "Civic"]);
    expect(await InventorySnapshot.ensure(db, first)).toBe("projected");

    // Present: the pass keeps it current, so a deploy leaves it alone.
    await add("B", PYP, [2006, "Honda", "Civic"]);
    expect(await InventorySnapshot.ensure(db, later)).toBe("current");
    expect(await InventorySnapshot.makeCounts(db)).toEqual([
      { make: "Honda", count: 1 },
    ]);
  } finally {
    client.close();
  }
});

test("explains a missing snapshot and how to store it", async () => {
  const { client, db } = await database();
  try {
    const error = await InventorySnapshot.makeCounts(db).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(InventorySnapshotError);
    expect(error).toMatchObject({ key: "v1:make-counts", reason: "missing" });
    expect(String(error)).toContain("bun run inventory:project");
  } finally {
    client.close();
  }
});

test("rejects a stored snapshot of another shape", async () => {
  const { client, db } = await database();
  try {
    await client.execute(
      `insert into inventory_snapshot values ('v1:make-counts', '[{"make":1}]', 0)`,
    );
    await expect(InventorySnapshot.makeCounts(db)).rejects.toMatchObject({
      key: "v1:make-counts",
      reason: "invalid",
    });
  } finally {
    client.close();
  }
});
