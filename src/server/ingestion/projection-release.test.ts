import { createClient } from "@libsql/client";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import {
  releasedProjection,
  releaseLegacyAlertMatchingRun,
  releaseProjectedRun,
} from "./projection-release";

const SCHEMA = `
  create table ingestion_run (
    id text primary key,
    status text not null,
    stage text not null,
    active_slot integer,
    projector_cursor integer not null default 0,
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
