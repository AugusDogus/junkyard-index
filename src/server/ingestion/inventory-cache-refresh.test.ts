import { createClient, type Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import type { ChangedInventorySources } from "~/lib/inventory-cache";
import { InventoryCacheRefresh } from "./inventory-cache-refresh";

let client: Client;

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    create table ingestion_run (
      id text primary key, publication_sequence integer, active_slot integer,
      accepted_sources text, completed_at integer, inventory_published_at integer
    );
    create table yard_inventory (
      source text not null, location_code text not null, updated_at integer not null,
      primary key (source, location_code)
    );
    create table yard_summary (
      source text not null, location_code text not null, built_for integer not null,
      data text not null, content_hash text not null, content_changed_at integer not null,
      primary key (source, location_code)
    );
    create table ingestion_projector_checkpoint (
      name text primary key not null,
      kind text default 'publication' not null,
      job_cursor text,
      job_day text,
      blocked_until integer,
      failure_count integer default 0 not null,
      last_error_tag text,
      last_success_at integer,
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

async function latestPublication(): Promise<number> {
  const result = await client.execute(
    "select coalesce(max(publication_sequence), 0) as latest from ingestion_run",
  );
  return Number(result.rows[0]?.latest ?? 0);
}

async function refreshedSequence() {
  const result = await client.execute(
    "select last_processed_change_id from ingestion_projector_checkpoint where name = 'inventory-cache-refresh'",
  );
  return result.rows[0]?.last_processed_change_id ?? null;
}

const NOW = new Date("2026-11-25T14:10:00Z");
const HOUR = 60 * 60 * 1000;

/** Yard `<source>-1` was published at `at`. */
async function yardPublished(source: string, at: number) {
  await client.execute({
    sql: "insert into yard_inventory (source, location_code, updated_at) values (?, ?, ?)",
    args: [source, `${source}-1`, at],
  });
}

/**
 * The summary store rebuilt yard `<source>-1`'s summary for its publication
 * at `builtFor`; what its pages show last changed at `contentChangedAt`.
 */
async function yardSummarized(
  source: string,
  builtFor: number,
  contentChangedAt: number,
) {
  await client.execute({
    sql: "insert into yard_summary values (?, ?, ?, '{}', 'hash', ?)",
    args: [source, `${source}-1`, builtFor, contentChangedAt],
  });
}

const yard = (source: string) => ({ source, code: `${source}-1` });

/** A refresh whose stored data starts out reflecting `projected`. */
function refresh(
  options: {
    projected?: number;
    project?: () => Promise<void>;
    revalidate?: () => void;
    now?: Date;
  } = {},
) {
  let projected = options.projected ?? 0;
  const calls: Array<"project" | "revalidate"> = [];
  const expired: ChangedInventorySources[] = [];
  return {
    run: () =>
      InventoryCacheRefresh.run({
        database: drizzle(client),
        now: options.now ?? NOW,
        source: {
          projectedThrough: async () => projected,
          project: async () => {
            calls.push("project");
            await options.project?.();
            projected = await latestPublication();
          },
        },
        revalidate: (changed) => {
          calls.push("revalidate");
          options.revalidate?.();
          expired.push(changed);
        },
      }),
    calls: () => calls,
    expired: () => expired,
  };
}

describe("InventoryCacheRefresh.run", () => {
  test("expires only the yards whose pages changed since the last refresh read them", async () => {
    await publish(1, 2);
    await InventoryCacheRefresh.record(
      drizzle(client),
      1,
      new Date(NOW.getTime() - 3 * HOUR),
    );
    const published = NOW.getTime() - HOUR;
    // Published, and its vehicles changed what its pages show.
    await yardPublished("pyp", published);
    await yardSummarized("pyp", published, published);
    // Published with nothing its pages show changed: left cached.
    await yardPublished("row52", published);
    await yardSummarized("row52", published, NOW.getTime() - 30 * HOUR);
    // Published, but its summary was not rebuilt: what changed is unknown.
    await yardPublished("calton", published);
    await yardSummarized(
      "calton",
      published - 24 * HOUR,
      published - 24 * HOUR,
    );
    // A content change stamped just before the last read is inside the margin.
    await yardPublished("pullapart", published);
    await yardSummarized(
      "pullapart",
      published,
      NOW.getTime() - 3 * HOUR - 10 * 60 * 1000,
    );
    // Nothing since the last read.
    await yardPublished("autorecycler", NOW.getTime() - 6 * HOUR);
    await yardSummarized(
      "autorecycler",
      NOW.getTime() - 6 * HOUR,
      NOW.getTime() - 6 * HOUR,
    );
    const caches = refresh({ projected: 1 });

    expect((await caches.run()).status).toBe("refreshed");

    expect(caches.expired()).toEqual([
      {
        kind: "sources",
        sources: [],
        yards: [yard("calton"), yard("pullapart"), yard("pyp")],
      },
    ]);
    // The next refresh counts changes from this one's read.
    await publish(3);
    const later = NOW.getTime() + HOUR;
    await yardPublished("copart", later);
    await yardSummarized("copart", later, later);
    const next = refresh({
      projected: 3,
      now: new Date(NOW.getTime() + 2 * HOUR),
    });
    await next.run();
    expect(next.expired()).toEqual([
      { kind: "sources", sources: [], yards: [yard("copart")] },
    ]);
  });

  test("expires every yard of a run that ended without publishing", async () => {
    await publish(1, 2);
    await InventoryCacheRefresh.record(
      drizzle(client),
      1,
      new Date(NOW.getTime() - 3 * HOUR),
    );
    // Abandoned after writing some of its vehicles, before publishing.
    await client.execute({
      sql: "insert into ingestion_run (id, accepted_sources, completed_at) values ('abandoned', ?, ?)",
      args: [JSON.stringify(["calton", "not-a-source"]), NOW.getTime() - HOUR],
    });
    // Published (its yards' summaries say what changed), still running, and
    // ended long ago: none counts.
    await client.execute({
      sql: `insert into ingestion_run (id, active_slot, accepted_sources, completed_at, inventory_published_at)
        values ('published', null, ?, ?, ?), ('running', 1, ?, null, null), ('old', null, ?, ?, null)`,
      args: [
        JSON.stringify(["pullapart"]),
        NOW.getTime() - HOUR,
        NOW.getTime() - HOUR,
        JSON.stringify(["pyp"]),
        JSON.stringify(["row52"]),
        NOW.getTime() - 9 * HOUR,
      ],
    });
    const caches = refresh({ projected: 1 });

    await caches.run();

    expect(caches.expired()).toEqual([
      { kind: "sources", sources: ["calton"], yards: [] },
    ]);
  });

  test("expires every source when no earlier read is recorded", async () => {
    await publish(1);
    await yardPublished("pyp", NOW.getTime() - HOUR);
    const caches = refresh();

    await caches.run();

    expect(caches.expired()).toEqual([{ kind: "all" }]);
  });

  test("does nothing when the caches and their data show the latest publication", async () => {
    await publish(1, 2, null);
    await InventoryCacheRefresh.record(drizzle(client), 2, NOW);
    const caches = refresh({ projected: 2 });

    expect(await caches.run()).toEqual({ status: "current" });

    expect(caches.calls()).toEqual([]);
    expect(await refreshedSequence()).toBe(2);
  });

  test("stores the data, then revalidates once for a newer publication", async () => {
    await publish(1, 2);
    await InventoryCacheRefresh.record(drizzle(client), 1, NOW);
    const caches = refresh({ projected: 1 });

    expect(await caches.run()).toEqual({
      status: "refreshed",
      publicationSequence: 2,
    });
    expect(await caches.run()).toEqual({ status: "current" });

    expect(caches.calls()).toEqual(["project", "revalidate"]);
    expect(await refreshedSequence()).toBe(2);
  });

  test("only revalidates when a deploy already stored the newer data", async () => {
    await publish(1, 2);
    await InventoryCacheRefresh.record(drizzle(client), 1, NOW);
    const caches = refresh({ projected: 2 });

    expect(await caches.run()).toEqual({
      status: "refreshed",
      publicationSequence: 2,
    });
    expect(caches.calls()).toEqual(["revalidate"]);
  });

  test("stores the data when another deployment refreshed the caches without it", async () => {
    await publish(1, 2);
    await InventoryCacheRefresh.record(drizzle(client), 2, NOW);
    const caches = refresh({ projected: 1 });

    expect(await caches.run()).toEqual({
      status: "refreshed",
      publicationSequence: 2,
    });
    expect(caches.calls()).toEqual(["project", "revalidate"]);
  });

  test("starts the checkpoint on the first refresh", async () => {
    await publish(1);
    const caches = refresh();

    expect(await caches.run()).toEqual({
      status: "refreshed",
      publicationSequence: 1,
    });

    expect(caches.calls()).toEqual(["project", "revalidate"]);
    expect(await refreshedSequence()).toBe(1);
  });

  test("has nothing to refresh before the first publication", async () => {
    await publish(null);
    const caches = refresh();

    expect(await caches.run()).toEqual({ status: "current" });

    expect(caches.calls()).toEqual([]);
    expect(await refreshedSequence()).toBeNull();
  });

  test("reports a failed store without revalidating, leaving the checkpoint behind", async () => {
    await publish(1, 2);
    await InventoryCacheRefresh.record(drizzle(client), 1, NOW);
    const failure = new Error("Turso is unavailable");
    const caches = refresh({
      projected: 1,
      project: async () => {
        throw failure;
      },
    });

    expect(await caches.run()).toEqual({
      status: "failed",
      stage: "project",
      publicationSequence: 2,
      error: failure,
    });
    expect(caches.calls()).toEqual(["project"]);
    expect(await refreshedSequence()).toBe(1);
  });

  test("retries only the revalidation after it fails, without storing the data again", async () => {
    await publish(1, 2);
    await InventoryCacheRefresh.record(drizzle(client), 1, NOW);
    const failure = new Error("revalidateTag is unavailable");
    let fail = true;
    const caches = refresh({
      projected: 1,
      revalidate: () => {
        if (fail) throw failure;
      },
    });

    expect(await caches.run()).toEqual({
      status: "failed",
      stage: "revalidate",
      publicationSequence: 2,
      error: failure,
    });
    expect(await refreshedSequence()).toBe(1);

    fail = false;
    expect(await caches.run()).toEqual({
      status: "refreshed",
      publicationSequence: 2,
    });
    expect(caches.calls()).toEqual(["project", "revalidate", "revalidate"]);
  });
});

describe("InventoryCacheRefresh.record", () => {
  test("never moves the checkpoint backward or touches other checkpoints", async () => {
    await InventoryCacheRefresh.record(drizzle(client), 5, NOW);
    await InventoryCacheRefresh.record(drizzle(client), 3, NOW);

    expect(await refreshedSequence()).toBe(5);
    const others = await client.execute(
      "select last_processed_change_id from ingestion_projector_checkpoint where name = 'vehicle_algolia'",
    );
    expect(others.rows[0]?.last_processed_change_id).toBe(3164343);
  });
});
