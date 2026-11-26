import { expect, mock, test } from "bun:test";
import { ACTIVE_INGESTION_SOURCES } from "~/lib/ingestion-source";
import { InventoryStaleness } from "~/lib/inventory-staleness";
import { createAdminTestDatabase } from "~/server/admin/admin-test-database";
import { StalenessBoundary } from "./staleness-boundary";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const start = new Date("2026-11-24T15:00:00Z");
const later = (hours: number) => new Date(start.getTime() + hours * HOUR);

function check(
  database: Parameters<typeof StalenessBoundary.check>[0]["database"],
  now: Date,
  revalidate: Parameters<typeof StalenessBoundary.check>[0]["revalidate"],
) {
  return StalenessBoundary.check({ database, now, revalidate });
}

async function database() {
  const { client, db } = await createAdminTestDatabase();
  await client.execute(`
    create table ingestion_projector_checkpoint (
      name text primary key,
      kind text default 'publication' not null,
      last_processed_change_id integer default 0 not null,
      job_cursor text,
      job_day text,
      blocked_until integer,
      failure_count integer default 0 not null,
      last_error_tag text,
      last_success_at integer,
      updated_at integer not null
    )
  `);
  let next = 0;
  const publish = async (source: string, at: number) => {
    next += 1;
    const id = `run-${next}`;
    await client.execute({
      sql: `insert into ingestion_run
        (id, source, status, stage, started_at, last_progress_at, inventory_published_at)
        values (?, ?, 'success', 'released', ?, ?, ?)`,
      args: [id, source, at - HOUR, at, at],
    });
    await client.execute({
      sql: `insert into ingestion_source_run
        (id, run_id, source, status, acceptance_status, started_at)
        values (?, ?, ?, 'success', 'accepted', ?)`,
      args: [`${id}-source`, id, source, at - HOUR],
    });
  };
  for (const source of ACTIVE_INGESTION_SOURCES)
    await publish(source, start.getTime() - 4 * HOUR);
  return { client, db, publish };
}

test("expires the caches on the first check, then only when a source crosses 36 hours or 7 days, however late the tick", async () => {
  const { client, db, publish } = await database();
  await client.execute(
    "delete from ingestion_source_run where source in ('pyp', 'upullrparts')",
  );
  await publish("pyp", start.getTime() - 34 * HOUR);
  await publish("upullrparts", start.getTime() - 6 * DAY - 22 * HOUR);
  const revalidate = mock<
    Parameters<typeof StalenessBoundary.check>[0]["revalidate"]
  >(() => undefined);
  const tick = (now: Date) => check(db, now, revalidate);

  // Nothing stored yet, so the caches may predate any class.
  expect(await tick(start)).toEqual({ status: "expired", changed: "unknown" });
  expect(await tick(start)).toEqual({ status: "unchanged" });
  expect(revalidate).toHaveBeenCalledTimes(1);

  // Three hours on, with ticks missed: upullrparts passed 7 days and pyp
  // passed 36 hours.
  expect(await tick(later(3))).toEqual({
    status: "expired",
    // In registry order.
    changed: ACTIVE_INGESTION_SOURCES.filter(
      (source) => source === "pyp" || source === "upullrparts",
    ),
  });
  expect(await tick(later(4))).toEqual({ status: "unchanged" });
  // Each expiry names what changed, so pages of those sources expire too.
  expect(revalidate.mock.calls).toEqual([
    ["unknown"],
    [
      ACTIVE_INGESTION_SOURCES.filter(
        (source) => source === "pyp" || source === "upullrparts",
      ),
    ],
  ]);

  // Its next publication makes upullrparts current again. That publication
  // expires the caches through the inventory refresh, so the boundary only
  // records the new class.
  await publish("upullrparts", later(5).getTime());
  expect(await tick(later(5))).toEqual({
    status: "recovered",
    sources: ["upullrparts"],
  });
  expect(revalidate).toHaveBeenCalledTimes(2);
  expect(await tick(later(6))).toEqual({ status: "unchanged" });
  client.close();
});

test("expires the caches when a recovery comes with a source going stale", async () => {
  const { client, db, publish } = await database();
  await client.execute("delete from ingestion_source_run where source = 'pyp'");
  await publish("pyp", start.getTime() - 40 * HOUR);
  const revalidate = mock(() => undefined);
  const tick = (now: Date) => check(db, now, revalidate);
  await tick(start);
  // pyp publishes as every other source, last published 4 hours before
  // start, passes 36 hours.
  await publish("pyp", later(33).getTime());
  expect(await tick(later(33))).toEqual({
    status: "expired",
    changed: [...ACTIVE_INGESTION_SOURCES],
  });
  expect(revalidate).toHaveBeenCalledTimes(2);
  client.close();
});

test("expires the caches when an outage starts or ends, since held sources change class without crossing their own threshold", async () => {
  const { client, db } = await database();
  const revalidate = mock(() => undefined);
  const tick = (now: Date) => check(db, now, revalidate);
  await tick(start);
  // No publication for two days: every source is stale, which is an outage.
  const outage = await tick(later(48));
  expect(outage.status).toBe("expired");
  expect(
    InventoryStaleness.autoHide(new Map(), later(48).getTime()).status,
  ).toBe("outage");
  expect(await tick(later(49))).toEqual({ status: "unchanged" });
  client.close();
});

test("keeps the last classification when expiring fails, so the next tick tries again", async () => {
  const { client, db, publish } = await database();
  await check(db, start, () => undefined);
  await client.execute("delete from ingestion_source_run where source = 'pyp'");
  await publish("pyp", start.getTime() - 40 * HOUR);
  await expect(
    check(db, start, () => {
      throw new Error("revalidateTag failed");
    }),
  ).rejects.toThrow("revalidateTag failed");
  expect(await check(db, start, () => undefined)).toEqual({
    status: "expired",
    changed: ["pyp"],
  });
  client.close();
});

test("reads an unreadable stored classification as unknown and expires the caches", async () => {
  const { client, db } = await database();
  await client.execute({
    sql: `insert into ingestion_projector_checkpoint (name, kind, job_cursor, updated_at)
      values (?, 'staleness', 'not json', 0)`,
    args: [StalenessBoundary.checkpointName],
  });
  const revalidate = mock(() => undefined);
  expect(await check(db, start, revalidate)).toEqual({
    status: "expired",
    changed: "unknown",
  });
  expect(revalidate).toHaveBeenCalledTimes(1);
  expect(await check(db, start, revalidate)).toEqual({ status: "unchanged" });
  client.close();
});
