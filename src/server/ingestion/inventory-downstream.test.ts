import { createClient, type Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { InventoryAnnouncement } from "../inventory-announcement";
import type { ConsumerMode } from "./consumer-flags";
import { InventoryCacheRefresh } from "./inventory-cache-refresh";
import {
  INVENTORY_DOWNSTREAM_INTERVAL_MS,
  InventoryDownstream,
} from "./inventory-downstream";
import {
  runInventoryDownstream,
  type AnnouncementStatus,
  type InventoryRefreshFailure,
} from "./inventory-downstream-consumer";

const HOUR = 60 * 60 * 1000;
const start = new Date("2026-11-20T12:00:00Z");
const at = (hours: number) => new Date(start.getTime() + hours * HOUR);

let client: Client;

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    create table ingestion_run (
      id text primary key,
      publication_sequence integer,
      inventory_published_at integer,
      commit_started_at integer,
      started_at integer not null default 0
    );
    create table ingestion_projector_checkpoint (
      name text primary key not null,
      kind text default 'publication' not null,
      last_processed_change_id integer default 0 not null,
      job_cursor text,
      job_day text,
      blocked_until integer,
      failure_count integer default 0 not null,
      last_error_tag text,
      last_success_at integer,
      updated_at integer default (cast(unixepoch('subsecond') * 1000 as integer)) not null
    );
  `);
});

afterEach(() => {
  client.close();
});

async function publish(sequence: number, publishedAt = start) {
  await client.execute({
    sql: `insert into ingestion_run (
      id, publication_sequence, inventory_published_at, commit_started_at, started_at
    ) values (?, ?, ?, ?, ?)`,
    args: [
      `run-${sequence}`,
      sequence,
      publishedAt.getTime(),
      publishedAt.getTime() + sequence,
      publishedAt.getTime(),
    ],
  });
}

async function checkpoint(name: string = InventoryDownstream.checkpointName) {
  const result = await client.execute({
    sql: "select last_processed_change_id as through, updated_at as at from ingestion_projector_checkpoint where name = ?",
    args: [name],
  });
  const row = result.rows[0];
  return row ? { through: Number(row.through), at: Number(row.at) } : null;
}

/** One consumer tick against the in-memory database at `now`. */
async function tick(
  now: Date,
  options: {
    mode?: ConsumerMode;
    refresh?: () => Promise<{ status: "ok" } | InventoryRefreshFailure>;
    warm?: (publicationSequence: number) => Promise<string[]>;
    announce?: () => Promise<AnnouncementStatus>;
  } = {},
) {
  const database = drizzle(client);
  const calls: string[] = [];
  const result = await runInventoryDownstream({
    due: () =>
      InventoryDownstream.due(database, now, options.mode ?? "enabled"),
    refresh: async () => {
      calls.push("refresh");
      return options.refresh ? options.refresh() : { status: "ok" };
    },
    warm: async (publicationSequence) => {
      calls.push(`warm:${publicationSequence}`);
      return options.warm ? options.warm(publicationSequence) : ["/cars"];
    },
    waitForPages: async () => {
      calls.push("wait");
    },
    announce: async (publicationSequence, paths) => {
      calls.push(`announce:${publicationSequence}:${paths.length}`);
      return options.announce ? options.announce() : "submitted";
    },
    record: async (publicationSequence, checkedAt) => {
      calls.push(`record:${publicationSequence}:${checkedAt}`);
      // A tick ends minutes after it checks: the refresh reads every
      // vehicle and warmup waits for pages to regenerate.
      await InventoryDownstream.record(
        database,
        publicationSequence,
        new Date(checkedAt),
      );
    },
  });
  return { result, calls };
}

describe("inventory-downstream consumer", () => {
  test("advances its checkpoint to the latest Turso publication, then waits for a newer one and the interval", async () => {
    await publish(1);
    await publish(2);
    await publish(3);

    const first = await tick(at(0));
    expect(first.result).toEqual({
      status: "refreshed",
      publicationSequence: 3,
      pagesChanged: 1,
      announcement: "submitted",
    });
    expect(first.calls).toEqual([
      "refresh",
      "warm:3",
      "wait",
      "announce:3:1",
      `record:3:${at(0).toISOString()}`,
    ]);
    expect(await checkpoint()).toEqual({ through: 3, at: at(0).getTime() });

    // Idempotent: nothing newer, so nothing runs again.
    const again = await tick(at(0));
    expect(again.result).toEqual({ status: "current", refreshedThrough: 3 });
    expect(again.calls).toEqual([]);

    await publish(4, at(1));
    const early = await tick(at(1));
    expect(early.result).toEqual({
      status: "recent",
      publicationSequence: 4,
      refreshedThrough: 3,
      nextRefreshAt: at(3).toISOString(),
    });
    expect(early.calls).toEqual([]);
    expect(await checkpoint()).toEqual({ through: 3, at: at(0).getTime() });

    const due = await tick(
      new Date(at(0).getTime() + INVENTORY_DOWNSTREAM_INTERVAL_MS),
    );
    expect(due.result).toMatchObject({
      status: "refreshed",
      publicationSequence: 4,
    });
    expect(await checkpoint()).toEqual({ through: 4, at: at(3).getTime() });
  });

  test("a paused consumer reads and refreshes nothing and keeps its checkpoint", async () => {
    await publish(3);
    await tick(at(0));
    await publish(5, at(1));

    const paused = await tick(at(10), { mode: "paused" });
    expect(paused.result).toEqual({ status: "paused" });
    expect(paused.calls).toEqual([]);
    expect(await checkpoint()).toEqual({ through: 3, at: at(0).getTime() });

    // Unpausing resumes from the kept checkpoint.
    const resumed = await tick(at(11));
    expect(resumed.result).toMatchObject({
      status: "refreshed",
      publicationSequence: 5,
    });
    expect(await checkpoint()).toEqual({ through: 5, at: at(11).getTime() });
  });

  test("a failed refresh leaves the checkpoint behind, so the next tick retries", async () => {
    await publish(7);
    const failed = await tick(at(0), {
      refresh: async () => ({
        status: "failed",
        stage: "project",
        message: "snapshot write failed",
      }),
    });
    expect(failed.result).toEqual({
      status: "refresh_failed",
      publicationSequence: 7,
      stage: "project",
      message: "snapshot write failed",
    });
    expect(failed.calls).toEqual(["refresh"]);
    expect(await checkpoint()).toBeNull();

    const retried = await tick(at(1));
    expect(retried.result).toMatchObject({
      status: "refreshed",
      publicationSequence: 7,
    });
    expect(await checkpoint()).toEqual({ through: 7, at: at(1).getTime() });
  });

  test("a failed announcement does not hold back the refresh checkpoint", async () => {
    await publish(2);
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    const result = await tick(at(0), {
      announce: async () => {
        throw new Error("IndexNow unreachable");
      },
    });
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
    expect(result.result).toEqual({
      status: "refreshed",
      publicationSequence: 2,
      pagesChanged: 1,
      announcement: "failed",
    });
    expect(await checkpoint()).toEqual({ through: 2, at: at(0).getTime() });
  });

  test("repeats none of the work an older deployment's pass end already did", async () => {
    const database = drizzle(client);
    await publish(1, at(-30));
    await publish(2, at(-1));
    // A pass started on the old code ends: it stores the snapshot, revalidates
    // the caches and announces publication 2, each recording its checkpoint.
    let projectedThrough = 0;
    const work: string[] = [];
    const cacheSource = {
      projectedThrough: async () => projectedThrough,
      project: async () => {
        work.push("project");
        projectedThrough = 2;
      },
    };
    const revalidate = () => {
      work.push("revalidate");
    };
    expect(
      await InventoryCacheRefresh.run({
        database,
        source: cacheSource,
        revalidate,
      }),
    ).toEqual({ status: "refreshed", publicationSequence: 2 });
    expect(
      await InventoryAnnouncement.window(database, 2, at(0)),
    ).not.toBeNull();
    await InventoryAnnouncement.record(database, 2);
    expect(work).toEqual(["project", "revalidate"]);

    // The consumer then runs its parts through their own checkpoints.
    const consumer = await tick(at(0), {
      refresh: async () => {
        const refresh = await InventoryCacheRefresh.run({
          database,
          source: cacheSource,
          revalidate,
        });
        expect(refresh).toEqual({ status: "current" });
        return { status: "ok" };
      },
      warm: async (publicationSequence) =>
        (await InventoryAnnouncement.window(
          database,
          publicationSequence,
          at(0),
        ))
          ? ["/cars"]
          : [],
    });
    expect(consumer.result).toEqual({
      status: "refreshed",
      publicationSequence: 2,
      pagesChanged: 0,
      announcement: "skipped",
    });
    expect(consumer.calls).toEqual([
      "refresh",
      "warm:2",
      `record:2:${at(0).toISOString()}`,
    ]);
    expect(work).toEqual(["project", "revalidate"]);
    expect(await checkpoint()).toEqual({ through: 2, at: at(0).getTime() });
    expect(await checkpoint("inventory-cache-refresh")).toMatchObject({
      through: 2,
    });
    expect(await checkpoint("indexnow-announcement")).toMatchObject({
      through: 2,
    });
  });

  test("never moves its checkpoint backward", async () => {
    const database = drizzle(client);
    await InventoryDownstream.record(database, 9, at(0));
    await InventoryDownstream.record(database, 4, at(5));
    expect(await checkpoint()).toEqual({ through: 9, at: at(0).getTime() });
  });

  test("is current before any publication", async () => {
    expect(await tick(at(0))).toEqual({
      result: { status: "current", refreshedThrough: 0 },
      calls: [],
    });
  });
});
