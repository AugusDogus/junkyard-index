import { createClient } from "@libsql/client";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import {
  clearLeftoverRebuildIndices,
  cleanupStaleRebuildIndices,
  cleanupInactiveRunRebuild,
  discardFailedRebuild,
  deleteRebuildIndex,
  type RebuildCleanupClient,
} from "./algolia-rebuild-index";

const SCHEMA = `create table ingestion_run (
  id text primary key, status text, active_slot integer, stage text,
  full_reindex_cursor text, full_reindex_move_task_id integer,
  last_progress_at integer
);`;
function fakeAlgolia(
  items: Array<{
    name: string;
    updatedAt: string;
    primary?: string;
    replicas?: string[];
  }>,
  deleted: string[],
) {
  return {
    async listIndices({ page }) {
      return {
        items: items.slice(page * 2, page * 2 + 2),
        nbPages: Math.ceil(items.length / 2),
      };
    },
    async deleteIndex({ indexName }) {
      deleted.push(indexName);
      return { taskID: 1 };
    },
    async waitForTask() {},
  } satisfies RebuildCleanupClient;
}

describe("Algolia rebuild index cleanup", () => {
  test("deletes stale project rebuilds across pages, protecting active rebuilds, main, replicas and unrelated indices", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(SCHEMA);
      await client.execute(
        "insert into ingestion_run (id, status, active_slot, stage) values ('active', 'running', 1, 'full_reindex_load'), ('ambiguous', 'running', 1, 'full_reindex_move_pending')",
      );
      const deleted: string[] = [];
      const old = "2026-08-01T00:00:00Z";
      const algolia = fakeAlgolia(
        [
          {
            name: "vehicles",
            updatedAt: old,
            replicas: ["vehicles__rebuild_replica"],
          },
          { name: "vehicles_distance", updatedAt: old, primary: "vehicles" },
          { name: "vehicles__rebuild_old", updatedAt: old },
          { name: "vehicles__rebuild_active", updatedAt: old },
          { name: "vehicles__rebuild_ambiguous", updatedAt: old },
          {
            name: "vehicles__rebuild_recent",
            updatedAt: "2026-08-22T06:00:00Z",
          },
          { name: "vehicles__rebuild_replica", updatedAt: old },
          {
            name: "vehicles__rebuild_virtual",
            updatedAt: old,
            primary: "vehicles",
          },
          { name: "other__rebuild_old", updatedAt: old },
          { name: "vehicles__rebuild_bad.suffix", updatedAt: old },
          { name: "vehicles__rebuild_", updatedAt: old },
          { name: "vehicles__rebuild_unknown-date", updatedAt: "" },
          { name: "vehicles__rebuild_abandoned", updatedAt: old },
        ],
        deleted,
      );
      await cleanupStaleRebuildIndices({
        database: drizzle(client),
        algolia,
        indexName: "vehicles",
        now: new Date("2026-08-22T07:00:00Z"),
      });
      expect(deleted).toEqual([
        "vehicles__rebuild_old",
        "vehicles__rebuild_abandoned",
      ]);
    } finally {
      client.close();
    }
  });

  test("a rebuild's start deletes every inactive run's copy, however recent, and tolerates a blocked app", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(SCHEMA);
      await client.execute(
        "insert into ingestion_run (id, status, active_slot, stage) values ('rebuilding', 'running', 1, 'full_reindex_prepare'), ('abandoned', 'abandoned', null, 'full_reindex_load'), ('failed', 'failed', null, 'full_reindex_load')",
      );
      const justNow = "2026-11-20T07:59:00Z";
      const attempted: string[] = [];
      const algolia = {
        ...fakeAlgolia(
          [
            {
              name: "vehicles",
              updatedAt: justNow,
              replicas: ["vehicles_distance"],
            },
            {
              name: "vehicles_distance",
              updatedAt: justNow,
              primary: "vehicles",
            },
            { name: "vehicles__rebuild_rebuilding", updatedAt: justNow },
            { name: "vehicles__rebuild_abandoned", updatedAt: justNow },
            { name: "vehicles__rebuild_failed", updatedAt: justNow },
            { name: "other__rebuild_abandoned", updatedAt: justNow },
          ],
          [],
        ),
        async deleteIndex({ indexName }: { indexName: string }) {
          attempted.push(indexName);
          if (indexName === "vehicles__rebuild_failed") return { taskID: 1 };
          throw Object.assign(new Error("Application is blocked"), {
            name: "ApiError",
            status: 403,
          });
        },
      } satisfies RebuildCleanupClient;
      await clearLeftoverRebuildIndices({
        database: drizzle(client),
        algolia,
        indexName: "vehicles",
      });
      expect(attempted).toEqual([
        "vehicles__rebuild_abandoned",
        "vehicles__rebuild_failed",
      ]);
    } finally {
      client.close();
    }
  });

  test.each([
    "full_reindex_prepare",
    "full_reindex_load",
    "full_reindex_publish",
    "full_reindex_publish_failed",
  ])(
    "discards a failed %s copy and resets its cursor for a complete rebuild on retry",
    async (stage) => {
      const client = createClient({ url: ":memory:" });
      try {
        await client.executeMultiple(SCHEMA);
        await client.execute({
          sql: "insert into ingestion_run values ('failed', 'running', 1, ?, 'VIN-CURSOR', null, 0)",
          args: [stage],
        });
        const deleted: string[] = [];
        await discardFailedRebuild({
          runId: "failed",
          database: drizzle(client),
          algolia: fakeAlgolia([], deleted),
          indexName: "vehicles",
        });
        expect(deleted).toEqual(["vehicles__rebuild_failed"]);
        expect(
          (
            await client.execute(
              "select stage, full_reindex_cursor from ingestion_run",
            )
          ).rows[0],
        ).toMatchObject({
          stage: "full_reindex_prepare",
          full_reindex_cursor: null,
        });
      } finally {
        client.close();
      }
    },
  );

  test("preserves an ambiguous move for durable recovery", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(SCHEMA);
      await client.execute(
        "insert into ingestion_run values ('pending', 'running', 1, 'full_reindex_move_pending', null, 42, 0)",
      );
      const deleted: string[] = [];
      await discardFailedRebuild({
        runId: "pending",
        database: drizzle(client),
        algolia: fakeAlgolia([], deleted),
        indexName: "vehicles",
      });
      expect(deleted).toEqual([]);
    } finally {
      client.close();
    }
  });

  test("deletion tolerates an already moved index but propagates other failures", async () => {
    const missing = Object.assign(new Error("missing"), { status: 404 });
    const denied = Object.assign(new Error("denied"), { status: 403 });
    const algolia = {
      async deleteIndex() {
        throw missing;
      },
      async waitForTask() {},
    };
    await deleteRebuildIndex(algolia, "vehicles", "gone");
    await expect(
      deleteRebuildIndex(
        {
          ...algolia,
          async deleteIndex() {
            throw denied;
          },
        },
        "vehicles",
        "gone",
      ),
    ).rejects.toBe(denied);
  });

  test("deletion leaves a copy in place, without failing, while the Algolia app is blocked", async () => {
    const blocked = Object.assign(new Error("Application is blocked"), {
      name: "ApiError",
      status: 403,
    });
    await deleteRebuildIndex(
      {
        async deleteIndex() {
          throw blocked;
        },
        async waitForTask() {},
      },
      "vehicles",
      "blocked",
    );
  });
});

test("terminal rebuild copies are removed immediately while active runs stay protected", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(SCHEMA);
    await client.execute(
      "insert into ingestion_run values ('abandoned', 'abandoned', null, 'full_reindex_load', null, null, 0), ('active', 'running', 1, 'full_reindex_load', null, null, 0)",
    );
    const deleted: string[] = [];
    const params = {
      database: drizzle(client),
      algolia: fakeAlgolia([], deleted),
      indexName: "vehicles",
    };
    await cleanupInactiveRunRebuild({ ...params, runId: "active" });
    await cleanupInactiveRunRebuild({ ...params, runId: "abandoned" });
    expect(deleted).toEqual(["vehicles__rebuild_abandoned"]);
  } finally {
    client.close();
  }
});
