import { createClient } from "@libsql/client";
import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { InventoryAnnouncement } from "./inventory-announcement";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = new Date("2026-11-10T12:00:00.000Z");
const hoursAgo = (hours: number) => now.getTime() - hours * HOUR;

async function database() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    create table ingestion_run (
      id text primary key, started_at integer not null,
      commit_started_at integer, publication_sequence integer,
      inventory_published_at integer
    );
    create table ingestion_projector_checkpoint (
      name text primary key,
      last_processed_change_id integer default 0 not null,
      updated_at integer not null
    );
  `);
  /** A run that claimed the commit `committedHoursAgo` and published 1h later. */
  const publish = (sequence: number, committedHoursAgo: number) =>
    client.execute({
      sql: "insert into ingestion_run values (?, ?, ?, ?, ?)",
      args: [
        `run-${sequence}`,
        hoursAgo(committedHoursAgo + 1),
        hoursAgo(committedHoursAgo),
        sequence,
        hoursAgo(committedHoursAgo - 1),
      ],
    });
  const checkpoint = async () =>
    (
      await client.execute(
        "select last_processed_change_id as id from ingestion_projector_checkpoint where name = 'indexnow-announcement'",
      )
    ).rows[0]?.id;
  return { client, db: drizzle(client), publish, checkpoint };
}

test("first covers the changes after the last run published a day ago", async () => {
  const { client, db, publish, checkpoint } = await database();
  try {
    await publish(1, 50);
    await publish(2, 20);
    await publish(3, 5);
    expect(await InventoryAnnouncement.window(db, 3, now)).toEqual({
      after: new Date(hoursAgo(50)),
      until: new Date(hoursAgo(5)),
    });
    expect(await checkpoint()).toBe(1);
  } finally {
    client.close();
  }
});

test("keeps its first checkpoint when the first announcement fails", async () => {
  const { client, db, publish } = await database();
  try {
    await publish(1, 50);
    await publish(2, 20);
    await InventoryAnnouncement.window(db, 2, now);
    // Nothing recorded; two days later the next publication's window still
    // starts after run 1, not a day before then.
    await publish(3, -40);
    const later = new Date(now.getTime() + 2 * DAY);
    expect(await InventoryAnnouncement.window(db, 3, later)).toEqual({
      after: new Date(hoursAgo(50)),
      until: new Date(hoursAgo(-40)),
    });
  } finally {
    client.close();
  }
});

test("then covers every publication after the last announced one", async () => {
  const { client, db, publish } = await database();
  try {
    // A day whose pass expired was never announced: 2 and 3 are both new.
    await publish(1, 60);
    await publish(2, 40);
    await publish(3, 5);
    // Published after the refresh being announced, so not shown yet.
    await publish(4, 0.5);
    await InventoryAnnouncement.record(db, 1);
    expect(await InventoryAnnouncement.window(db, 3, now)).toEqual({
      after: new Date(hoursAgo(60)),
      until: new Date(hoursAgo(5)),
    });
  } finally {
    client.close();
  }
});

test("covers the changes of a run that committed but never published", async () => {
  const { client, db, publish } = await database();
  try {
    await publish(1, 29);
    // Abandoned after reconciling 10 hours ago: stamped rows, no sequence.
    await client.execute({
      sql: "insert into ingestion_run values ('abandoned', ?, ?, null, null)",
      args: [hoursAgo(11), hoursAgo(10)],
    });
    await publish(2, 5);
    await InventoryAnnouncement.record(db, 1);
    const window = await InventoryAnnouncement.window(db, 2, now);
    expect(window).toEqual({
      after: new Date(hoursAgo(29)),
      until: new Date(hoursAgo(5)),
    });
  } finally {
    client.close();
  }
});

test("finds nothing once the publication is announced", async () => {
  const { client, db, publish } = await database();
  try {
    await publish(1, 5);
    await InventoryAnnouncement.record(db, 1);
    expect(await InventoryAnnouncement.window(db, 1, now)).toBeNull();
  } finally {
    client.close();
  }
});

test("looks back at most a week", async () => {
  const { client, db, publish } = await database();
  try {
    await publish(1, 30 * 24);
    await publish(2, 20 * 24);
    await publish(3, 5);
    await InventoryAnnouncement.record(db, 1);
    expect(await InventoryAnnouncement.window(db, 3, now)).toEqual({
      after: new Date(now.getTime() - 7 * DAY),
      until: new Date(hoursAgo(5)),
    });
  } finally {
    client.close();
  }
});

test("records announcements without moving backward", async () => {
  const { client, db, checkpoint } = await database();
  try {
    await InventoryAnnouncement.record(db, 5);
    await InventoryAnnouncement.record(db, 3);
    expect(await checkpoint()).toBe(5);
    await InventoryAnnouncement.record(db, 7);
    expect(await checkpoint()).toBe(7);
  } finally {
    client.close();
  }
});
