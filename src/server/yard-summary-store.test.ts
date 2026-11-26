import { createClient, type Client } from "@libsql/client";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync } from "node:fs";
import { YardSummaryStore } from "./yard-summary-store";

let client: Client;
const NOW = new Date("2026-11-26T14:10:00Z");

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    create table vehicle (
      vin text primary key, source text not null, year integer not null,
      make text not null, model text not null, source_model text, trim text,
      engine text, color text, stock_number text, section text, row text,
      space text, available_date text, first_seen_at integer not null,
      observed_arrival_at integer, image_url text, details_url text,
      location_code text not null, missing_since_at integer
    );
    create table yard_inventory (
      source text not null, location_code text not null, updated_at integer not null,
      primary key (source, location_code)
    );
    ${readFileSync(new URL("../../drizzle/0035_yard_make_index_and_summary.sql", import.meta.url), "utf8")}
  `);
});

afterEach(() => client.close());

async function addVehicle(vin: string, code: string, make: string) {
  await client.execute({
    sql: `insert into vehicle (vin, source, year, make, model, first_seen_at, location_code)
      values (?, 'pyp', 2004, ?, 'Civic', 1700000000000, ?)`,
    args: [vin, make, code],
  });
}

async function publish(code: string, at: number) {
  await client.execute({
    sql: `insert into yard_inventory (source, location_code, updated_at) values ('pyp', ?, ?)
      on conflict (source, location_code) do update set updated_at = excluded.updated_at`,
    args: [code, at],
  });
}

test("stores a summary for each yard whose publication it has not seen, and reads it back", async () => {
  const database = drizzle(client);
  await addVehicle("A", "1", "HONDA");
  await addVehicle("B", "1", "Ford");
  await addVehicle("C", "2", "Ford");
  await publish("1", 100);
  await publish("2", 100);

  expect(await YardSummaryStore.read(database, "pyp", "1")).toBeNull();
  expect(await YardSummaryStore.refresh(database, NOW)).toEqual({
    stored: 2,
    changed: [
      { source: "pyp", code: "1" },
      { source: "pyp", code: "2" },
    ],
  });
  // Nothing new to store.
  expect(await YardSummaryStore.refresh(database, NOW)).toEqual({
    stored: 0,
    changed: [],
  });

  const summary = await YardSummaryStore.read(database, "pyp", "1");
  expect(summary?.total).toBe(2);
  expect(summary?.makes.map((make) => make.key).sort()).toEqual([
    "FORD",
    "HONDA",
  ]);
  expect(summary?.makeLists.find((list) => list.key === "FORD")).toMatchObject({
    spellings: ["Ford"],
  });
});

test("ignores a summary stored for an earlier publication until the next refresh", async () => {
  const database = drizzle(client);
  await addVehicle("A", "1", "HONDA");
  await publish("1", 100);
  await YardSummaryStore.refresh(database, NOW);

  await addVehicle("B", "1", "HONDA");
  await publish("1", 200);
  expect(await YardSummaryStore.read(database, "pyp", "1")).toBeNull();

  expect(await YardSummaryStore.refresh(database, NOW)).toEqual({
    stored: 1,
    changed: [{ source: "pyp", code: "1" }],
  });
  expect((await YardSummaryStore.read(database, "pyp", "1"))?.total).toBe(2);
});

test("clearing drops every stored summary, as identities may have changed", async () => {
  const database = drizzle(client);
  await addVehicle("A", "1", "HONDA");
  await publish("1", 100);
  await YardSummaryStore.refresh(database, NOW);

  await YardSummaryStore.clear(database);

  expect(await YardSummaryStore.read(database, "pyp", "1")).toBeNull();
  expect(await YardSummaryStore.refresh(database, NOW)).toEqual({
    stored: 1,
    changed: [{ source: "pyp", code: "1" }],
  });
});

test("drops summaries of yards that left yard_inventory", async () => {
  const database = drizzle(client);
  await addVehicle("A", "1", "HONDA");
  await publish("1", 100);
  await YardSummaryStore.refresh(database, NOW);
  await client.execute("delete from yard_inventory");

  await YardSummaryStore.refresh(database, NOW);

  const left = await client.execute("select count(*) as n from yard_summary");
  expect(Number(left.rows[0]?.n)).toBe(0);
});

test("a publication that changed nothing a yard's pages show leaves the yard unchanged", async () => {
  const database = drizzle(client);
  await addVehicle("A", "1", "HONDA");
  await addVehicle("B", "2", "Ford");
  await publish("1", 100);
  await publish("2", 100);
  await YardSummaryStore.refresh(database, NOW);

  // Both yards publish again; only yard 2's vehicles changed.
  await client.execute("update vehicle set color = 'Red' where vin = 'B'");
  await publish("1", 200);
  await publish("2", 200);

  expect(await YardSummaryStore.refresh(database, NOW)).toEqual({
    stored: 2,
    changed: [{ source: "pyp", code: "2" }],
  });
  expect((await YardSummaryStore.read(database, "pyp", "1"))?.total).toBe(1);
});

test("records when each yard's content last changed", async () => {
  const database = drizzle(client);
  await addVehicle("A", "1", "HONDA");
  await publish("1", 100);
  await YardSummaryStore.refresh(database, new Date(1_000));
  await publish("1", 200);
  await YardSummaryStore.refresh(database, new Date(2_000));
  const unchanged = await client.execute(
    "select content_changed_at from yard_summary",
  );
  expect(Number(unchanged.rows[0]?.content_changed_at)).toBe(1_000);

  await addVehicle("B", "1", "HONDA");
  await publish("1", 300);
  await YardSummaryStore.refresh(database, new Date(3_000));
  const changed = await client.execute(
    "select content_changed_at from yard_summary",
  );
  expect(Number(changed.rows[0]?.content_changed_at)).toBe(3_000);
});
