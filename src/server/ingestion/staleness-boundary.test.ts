import { expect, test } from "bun:test";
import { createAdminTestDatabase } from "~/server/admin/admin-test-database";
import { sourcesPastStalenessBoundary } from "./staleness-boundary";

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-11-24T15:00:00Z");

test("finds the sources that went stale or hid since the last hourly check, and none that stayed put", async () => {
  const { client, db } = await createAdminTestDatabase();
  const publish = async (source: string, hoursAgo: number) => {
    const at = now.getTime() - hoursAgo * HOUR;
    await client.execute({
      sql: `insert into ingestion_run
        (id, source, status, stage, started_at, last_progress_at, inventory_published_at)
        values (?, ?, 'success', 'released', ?, ?, ?)`,
      args: [source, source, at - HOUR, at, at],
    });
    await client.execute({
      sql: `insert into ingestion_source_run
        (id, run_id, source, status, acceptance_status, started_at)
        values (?, ?, ?, 'success', 'accepted', ?)`,
      args: [`${source}-source`, source, source, at - HOUR],
    });
  };
  await publish("pyp", 36.5);
  await publish("upullrparts", 7 * 24 + 0.25);
  await publish("row52", 20);
  await publish("hollanderstores", 82);
  expect((await sourcesPastStalenessBoundary(db, now)).sort()).toEqual([
    "pyp",
    "upullrparts",
  ]);
  client.close();
});
