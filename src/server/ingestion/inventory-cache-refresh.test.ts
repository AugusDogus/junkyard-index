import { createClient, type Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { InventoryCacheRefresh } from "./inventory-cache-refresh";

let client: Client;

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    create table ingestion_run (id text primary key, publication_sequence integer);
    create table ingestion_projector_checkpoint (
      name text primary key not null,
      last_processed_change_id integer default 0 not null,
      updated_at integer default (cast(unixepoch('subsecond') * 1000 as integer)) not null
    );
    insert into ingestion_projector_checkpoint (name, last_processed_change_id)
      values ('vehicle_algolia', 3164343);
  `);
});

afterEach(() => {
  client.close();
});

async function publish(...sequences: Array<number | null>) {
  for (const [index, sequence] of sequences.entries()) {
    await client.execute({
      sql: "insert into ingestion_run (id, publication_sequence) values (?, ?)",
      args: [`run-${sequence ?? "unpublished"}-${index}`, sequence],
    });
  }
}

async function refreshedSequence() {
  const result = await client.execute(
    "select last_processed_change_id from ingestion_projector_checkpoint where name = 'inventory-cache-refresh'",
  );
  return result.rows[0]?.last_processed_change_id ?? null;
}

function refresh() {
  let revalidations = 0;
  return {
    run: () =>
      InventoryCacheRefresh.run({
        database: drizzle(client),
        revalidate: () => {
          revalidations += 1;
        },
      }),
    revalidations: () => revalidations,
  };
}

describe("InventoryCacheRefresh.run", () => {
  test("skips revalidation when the caches already show the latest publication", async () => {
    await publish(1, 2, null);
    await InventoryCacheRefresh.record(drizzle(client), 2);
    const caches = refresh();

    expect(await caches.run()).toEqual({ status: "current" });

    expect(caches.revalidations()).toBe(0);
    expect(await refreshedSequence()).toBe(2);
  });

  test("revalidates once for a newer publication, then skips until another one", async () => {
    await publish(1, 2);
    await InventoryCacheRefresh.record(drizzle(client), 1);
    const caches = refresh();

    expect(await caches.run()).toEqual({
      status: "refreshed",
      publicationSequence: 2,
    });
    expect(await caches.run()).toEqual({ status: "current" });

    expect(caches.revalidations()).toBe(1);
    expect(await refreshedSequence()).toBe(2);
  });

  test("starts the checkpoint on the first refresh", async () => {
    await publish(1);
    const caches = refresh();

    expect(await caches.run()).toEqual({
      status: "refreshed",
      publicationSequence: 1,
    });

    expect(caches.revalidations()).toBe(1);
    expect(await refreshedSequence()).toBe(1);
  });

  test("has nothing to refresh before the first publication", async () => {
    await publish(null);
    const caches = refresh();

    expect(await caches.run()).toEqual({ status: "current" });

    expect(caches.revalidations()).toBe(0);
    expect(await refreshedSequence()).toBeNull();
  });

  test("leaves the checkpoint behind when revalidation fails, so the next pass retries", async () => {
    await publish(1, 2);
    await InventoryCacheRefresh.record(drizzle(client), 1);
    const failure = new Error("revalidateTag is unavailable");

    expect(
      await InventoryCacheRefresh.run({
        database: drizzle(client),
        revalidate: () => {
          throw failure;
        },
      }),
    ).toEqual({ status: "failed", publicationSequence: 2, error: failure });
    expect(await refreshedSequence()).toBe(1);

    const caches = refresh();
    expect(await caches.run()).toEqual({
      status: "refreshed",
      publicationSequence: 2,
    });
    expect(caches.revalidations()).toBe(1);
  });
});

describe("InventoryCacheRefresh.record", () => {
  test("never moves the checkpoint backward or touches other checkpoints", async () => {
    await InventoryCacheRefresh.record(drizzle(client), 5);
    await InventoryCacheRefresh.record(drizzle(client), 3);

    expect(await refreshedSequence()).toBe(5);
    const others = await client.execute(
      "select last_processed_change_id from ingestion_projector_checkpoint where name = 'vehicle_algolia'",
    );
    expect(others.rows[0]?.last_processed_change_id).toBe(3164343);
  });
});
