import { createClient } from "@libsql/client";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import {
  releasedProjection,
  releaseLegacyAlertMatchingRun,
  releaseProjectedRun,
  releaseToSearchProjector,
} from "./projection-release";

const SCHEMA = `
  create table ingestion_run (
    id text primary key,
    status text not null,
    stage text not null,
    active_slot integer,
    projector_cursor integer not null default 0,
    full_reindex_required integer not null default 0,
    last_progress_at integer not null default 0,
    search_published_at integer,
    released_at integer,
    completed_at integer
  );
`;

const NOW = new Date("2026-11-20T18:00:00.000Z");

async function setup() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(SCHEMA);
  return { client, database: drizzle(client) };
}

async function run(client: ReturnType<typeof createClient>, id: string) {
  const result = await client.execute({
    sql: "select status, stage, active_slot, search_published_at, released_at, completed_at from ingestion_run where id = ?",
    args: [id],
  });
  return result.rows[0];
}

describe("projection release", () => {
  test("the final projection batch releases the run and frees the commit", async () => {
    const { client, database } = await setup();
    try {
      await client.execute(
        "insert into ingestion_run (id, status, stage, active_slot, projector_cursor) values ('run-1', 'running', 'project_changes', 1, 40)",
      );
      // A stale cursor means another worker advanced the run.
      expect(
        await releaseProjectedRun({
          database,
          runId: "run-1",
          projectorCursor: 39,
          now: NOW,
        }),
      ).toEqual({ status: "stopped" });
      expect(await run(client, "run-1")).toMatchObject({
        status: "running",
        active_slot: 1,
      });

      expect(
        await releaseProjectedRun({
          database,
          runId: "run-1",
          projectorCursor: 40,
          now: NOW,
        }),
      ).toEqual({ status: "complete", searchPublishedAt: NOW });
      expect(await run(client, "run-1")).toEqual(
        expect.objectContaining({
          status: "success",
          stage: "released",
          active_slot: null,
          search_published_at: NOW.getTime(),
          released_at: NOW.getTime(),
          completed_at: NOW.getTime(),
        }),
      );
    } finally {
      client.close();
    }
  });

  test("a retried final batch completes on the run it already released", async () => {
    const publishedAt = new Date("2026-11-20T17:00:00.000Z");
    expect(
      releasedProjection({
        status: "success",
        stage: "released",
        searchPublishedAt: publishedAt,
      }),
    ).toEqual({ status: "complete", searchPublishedAt: publishedAt });
    // Anything else still goes through the stage dispatch (or stops).
    for (const run of [
      { status: "running", stage: "project_changes" },
      { status: "abandoned", stage: "reconcile_upsert" },
      { status: "running", stage: "match_alerts" },
    ]) {
      expect(
        releasedProjection({ ...run, searchPublishedAt: null }),
      ).toBeNull();
    }
  });

  test("a run the previous release left matching alerts is released without matching, once", async () => {
    const { client, database } = await setup();
    try {
      const publishedAt = new Date("2026-11-20T17:30:00.000Z");
      await client.execute({
        sql: "insert into ingestion_run (id, status, stage, active_slot, search_published_at) values ('legacy', 'running', 'match_alerts', 1, ?)",
        args: [publishedAt.getTime()],
      });
      expect(
        await releaseLegacyAlertMatchingRun({
          database,
          runId: "legacy",
          searchPublishedAt: publishedAt,
          now: NOW,
        }),
      ).toEqual({ status: "complete", searchPublishedAt: publishedAt });
      expect(await run(client, "legacy")).toEqual(
        expect.objectContaining({
          status: "success",
          stage: "released",
          active_slot: null,
          // Search publication keeps its original time.
          search_published_at: publishedAt.getTime(),
          released_at: NOW.getTime(),
        }),
      );
      expect(
        await releaseLegacyAlertMatchingRun({
          database,
          runId: "legacy",
          searchPublishedAt: publishedAt,
          now: NOW,
        }),
      ).toEqual({ status: "stopped" });
    } finally {
      client.close();
    }
  });
});

describe("handoff to the search projector", () => {
  test("releases runs in inline search stages without search, but keeps a pending move and other runs", async () => {
    const { client, database } = await setup();
    try {
      await client.executeMultiple(`
        insert into ingestion_run (id, status, stage, active_slot) values
          ('projecting', 'running', 'project_changes', 1);
        insert into ingestion_run (id, status, stage, active_slot, full_reindex_required) values
          ('preparing', 'running', 'full_reindex_prepare', 1, 1);
        insert into ingestion_run (id, status, stage, active_slot) values
          ('loading', 'running', 'full_reindex_load', 1),
          ('publishing', 'running', 'full_reindex_publish', 1),
          ('publish-failed', 'running', 'full_reindex_publish_failed', 1),
          ('moving', 'running', 'full_reindex_move_pending', 1),
          ('reconciling', 'running', 'reconcile_missing', 1),
          ('abandoned', 'abandoned', 'project_changes', null)
      `);
      const handoff = (runId: string) =>
        releaseToSearchProjector({ database, runId, now: NOW });
      for (const id of [
        "projecting",
        "preparing",
        "loading",
        "publishing",
        "publish-failed",
      ]) {
        expect(await handoff(id)).toEqual({
          status: "complete",
          releasedTo: "search_projector",
        });
        expect({ ...(await run(client, id)) }).toEqual({
          status: "success",
          stage: "released",
          active_slot: null,
          // Not searchable yet: the projector publishes its changes.
          search_published_at: null,
          released_at: NOW.getTime(),
          completed_at: NOW.getTime(),
        });
      }
      // Handing off keeps the rebuild a run owed, for the projector's own
      // rebuild to settle; its change rows are not touched at all.
      const owed = await client.execute(
        "select id, full_reindex_required from ingestion_run where id in ('projecting', 'preparing') order by id",
      );
      expect(
        owed.rows.map((row) => [row.id, row.full_reindex_required]),
      ).toEqual([
        ["preparing", 1],
        ["projecting", 0],
      ]);
      // A retried step finds the run handed off, not published.
      expect(
        releasedProjection({
          status: "success",
          stage: "released",
          searchPublishedAt: null,
        }),
      ).toEqual({ status: "complete", releasedTo: "search_projector" });
      for (const id of ["moving", "reconciling", "abandoned"]) {
        const before = { ...(await run(client, id)) };
        expect(await handoff(id)).toBeNull();
        expect({ ...(await run(client, id)) }).toEqual(before);
      }
    } finally {
      client.close();
    }
  });
});
