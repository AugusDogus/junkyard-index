import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { HiddenSources } from "~/lib/hidden-source";
import { ACTIVE_INGESTION_SOURCES } from "~/lib/ingestion-source";
import { InventoryStaleness } from "~/lib/inventory-staleness";
import { createAdminTestDatabase } from "~/server/admin/admin-test-database";
import { loadHiddenSources } from "./hidden-sources";

const migration = readFileSync(
  new URL("../../../drizzle/0030_source_control.sql", import.meta.url),
  "utf8",
);

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = new Date("2026-11-24T15:00:00Z");

async function database() {
  const { client, db } = await createAdminTestDatabase();
  await client.executeMultiple(migration);
  let next = 0;
  const publish = async (source: string, publishedAt: number) => {
    next += 1;
    const id = `run-${next}`;
    await client.execute({
      sql: `insert into ingestion_run
        (id, source, status, stage, started_at, last_progress_at, inventory_published_at)
        values (?, ?, 'success', 'released', ?, ?, ?)`,
      args: [id, source, publishedAt - HOUR, publishedAt, publishedAt],
    });
    await client.execute({
      sql: `insert into ingestion_source_run
        (id, run_id, source, status, acceptance_status, started_at, completed_at)
        values (?, ?, ?, 'success', 'accepted', ?, ?)`,
      args: [`${id}-source`, id, source, publishedAt - HOUR, publishedAt],
    });
  };
  // Every active source published this morning, as on a healthy day.
  for (const source of ACTIVE_INGESTION_SOURCES)
    await publish(source, now.getTime() - 4 * HOUR);
  return { client, db, publish };
}

describe("loadHiddenSources", () => {
  test("keeps the owner's hides and hides nothing else while every source is current", async () => {
    const { db } = await database();
    // The migration seeds Meeks hidden by the owner.
    expect((await loadHiddenSources(db, now)).list).toEqual(["meeks"]);
  });

  test("keeps a source shown while stale for under 7 days", async () => {
    const { client, db, publish } = await database();
    await client.execute(
      "delete from ingestion_source_run where source = 'hollanderstores'",
    );
    await publish("hollanderstores", now.getTime() - 82 * HOUR);
    expect((await loadHiddenSources(db, now)).list).not.toContain(
      "hollanderstores",
    );
  });

  test("hides a source after 7 days without an accepted publication, and shows it again after its next one", async () => {
    const { client, db, publish } = await database();
    await client.execute(
      "delete from ingestion_source_run where source = 'upullrparts'",
    );
    await publish("upullrparts", now.getTime() - 13 * DAY);
    // A rejected run since does not count as a publication.
    await client.execute({
      sql: `insert into ingestion_run (id, source, status, stage, started_at, last_progress_at)
        values ('rejected', 'upullrparts', 'success', 'released', ?, ?)`,
      args: [now.getTime() - 2 * HOUR, now.getTime() - HOUR],
    });
    await client.execute({
      sql: `insert into ingestion_source_run (id, run_id, source, status, acceptance_status, started_at)
        values ('rejected-source', 'rejected', 'upullrparts', 'success', 'rejected', ?)`,
      args: [now.getTime() - 2 * HOUR],
    });
    expect((await loadHiddenSources(db, now)).list).toEqual([
      "upullrparts",
      "meeks",
    ]);

    await publish("upullrparts", now.getTime() - HOUR);
    expect((await loadHiddenSources(db, now)).list).toEqual(["meeks"]);
  });

  test("hides a source with no accepted publication in the lookback at all", async () => {
    const { client, db } = await database();
    await client.execute(
      "delete from ingestion_source_run where source = 'pyp'",
    );
    expect((await loadHiddenSources(db, now)).list).toContain("pyp");
  });

  test("skips the 7-day hide during an ingestion outage, so the site keeps stale vehicles with their labels, and keeps the owner's hides", async () => {
    const { client, db, publish } = await database();
    const outage = ACTIVE_INGESTION_SOURCES.slice(
      0,
      InventoryStaleness.outageAfterStale(ACTIVE_INGESTION_SOURCES.length),
    );
    for (const source of outage) {
      await client.execute({
        sql: "delete from ingestion_source_run where source = ?",
        args: [source],
      });
      await publish(source, now.getTime() - 8 * DAY);
    }
    expect((await loadHiddenSources(db, now)).list).toEqual(["meeks"]);

    // One source recovering ends the outage, and the rest hide.
    const [recovered, ...stillStale] = outage;
    if (recovered === undefined) throw new Error("No outage fixture source.");
    await publish(recovered, now.getTime() - HOUR);
    expect((await loadHiddenSources(db, now)).list).toEqual(
      HiddenSources.of([...stillStale, "meeks"]).list,
    );
  });
});
