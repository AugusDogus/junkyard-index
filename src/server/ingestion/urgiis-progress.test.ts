import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { UrgiisCursor } from "./urgiis-cursor";
import { URGIIS_TENANTS } from "./urgiis-configuration";
import { reportUrgiisCensusProgress } from "./urgiis-progress";
import {
  createTestClient,
  TEST_SCHEMA,
} from "./durable-ingestion-test-fixtures";
import type { DurableSourceChunkResult } from "./durable-ingestion-types";

const initial = UrgiisCursor.checkpoint({
  ...UrgiisCursor.initial(),
  startedAt: 1,
  asOf: 1,
  runKind: "cold",
});
const first = URGIIS_TENANTS[0];
const second = URGIIS_TENANTS[1];
if (!first || !second) throw new Error("Missing census tenants");
const completed = UrgiisCursor.nextTenant(
  initial,
  { code: first.code, accepted: first.minimumInventory },
  URGIIS_TENANTS,
  "state",
);
const next = UrgiisCursor.nextTenant(
  completed,
  { code: second.code, accepted: second.minimumInventory },
  URGIIS_TENANTS,
  "state",
);
const chunk = (cursor: UrgiisCursor): DurableSourceChunkResult<"urgiis"> => ({
  cursor,
  status: "paused",
  count: first.minimumInventory,
  errors: [],
  pagesProcessed: 0,
});

test("cold census heartbeats require a new accepted tenant and never repeat progress across failed runs", async () => {
  const { client } = createTestClient();
  const database = drizzle(client);
  let pings = 0;
  const report = (
    before: UrgiisCursor,
    result: DurableSourceChunkResult<"urgiis">,
  ) =>
    reportUrgiisCensusProgress({
      database,
      runId: "current",
      before,
      result,
      ping: async () => {
        pings++;
      },
    });
  try {
    await client.executeMultiple(TEST_SCHEMA);
    await report(initial, chunk(initial)); // Pages or a cooldown.
    await report(initial, { ...chunk(completed), status: "failed" });
    const blocked = UrgiisCursor.nextTenant(
      initial,
      { code: first.code, blocked: "explicit empty" },
      URGIIS_TENANTS,
      "state",
    );
    await report(initial, chunk(blocked));
    await report(completed, chunk(completed)); // Replayed checkpoint.
    await report(
      initial,
      chunk(UrgiisCursor.checkpoint({ ...completed, runKind: "incremental" })),
    );
    expect(pings).toBe(0);
    await report(initial, chunk(completed));
    expect(pings).toBe(1);
    await client.execute(
      "insert into ingestion_run (id, source, status, started_at, last_progress_at) values ('failed', 'urgiis', 'error', 1, 1)",
    );
    await client.execute({
      sql: "insert into ingestion_source_run (id, run_id, source, status, next_cursor, started_at) values ('failed:urgiis', 'failed', 'urgiis', 'error', ?, 1)",
      args: [UrgiisCursor.serialize(completed)],
    });
    await report(initial, chunk(completed)); // Same healthy tenant, new attempt.
    expect(pings).toBe(1);
    await report(completed, chunk(next)); // Genuine new progress.
    expect(pings).toBe(2);
    await client.execute(
      "update ingestion_source_run set next_cursor = 'corrupt' where run_id = 'failed'",
    );
    await report(initial, chunk(completed));
    expect(pings).toBe(3);
    await client.execute({
      sql: "update ingestion_source_run set next_cursor = ? where run_id = 'failed'",
      args: [UrgiisCursor.serialize(completed)],
    });
    await client.execute(
      "insert into ingestion_run (id, source, status, started_at, last_progress_at, search_published_at) values ('published', 'urgiis', 'success', 2, 2, 3)",
    );
    await client.execute(
      "insert into ingestion_source_run (id, run_id, source, status, acceptance_status, started_at) values ('published:urgiis', 'published', 'urgiis', 'success', 'accepted', 2)",
    );
    await report(initial, chunk(completed)); // A later cold cycle starts after publication.
    expect(pings).toBe(4);
  } finally {
    client.close();
  }
});

test("recovery runs, which share the three-day deadline, heartbeat each newly accepted tenant", async () => {
  const { client } = createTestClient();
  const database = drizzle(client);
  let pings = 0;
  const recovery = (cursor: UrgiisCursor) =>
    UrgiisCursor.checkpoint({ ...cursor, runKind: "recovery" });
  try {
    await client.executeMultiple(TEST_SCHEMA);
    await reportUrgiisCensusProgress({
      database,
      runId: "current",
      before: recovery(initial),
      result: chunk(recovery(completed)),
      ping: async () => {
        pings++;
      },
    });
    expect(pings).toBe(1);
  } finally {
    client.close();
  }
});
