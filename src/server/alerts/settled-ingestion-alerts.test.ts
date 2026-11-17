import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { ingestionRun, ingestionSourceRun } from "~/schema";
import {
  createTestClient,
  TEST_SCHEMA,
} from "~/server/ingestion/durable-ingestion-test-fixtures";
import { canMatchSettledIngestionAlerts } from "./settled-ingestion-alerts";

const now = new Date("2026-11-17T12:00:00Z");

test("early publication cannot match alerts while a native fetch or its retry is outstanding", async () => {
  const { client, cleanup } = createTestClient();
  try {
    await client.executeMultiple(TEST_SCHEMA);
    const database = drizzle(client);
    await database.insert(ingestionRun).values([
      {
        id: "market",
        source: "autorecycler",
        scheduleKey: "2026-11-17",
        status: "running",
        stage: "match_alerts",
        activeSlot: 1,
        searchPublishedAt: now,
        startedAt: now,
        lastProgressAt: now,
      },
      {
        id: "native",
        source: "pontiac",
        scheduleKey: "2026-11-17",
        status: "running",
        stage: "sources",
        activeSlot: 1,
        startedAt: now,
        lastProgressAt: now,
      },
    ]);
    await database.insert(ingestionSourceRun).values([
      {
        id: "market:autorecycler",
        runId: "market",
        source: "autorecycler",
        status: "success",
        acceptanceStatus: "accepted",
        startedAt: now,
      },
      {
        id: "native:pontiac",
        runId: "native",
        source: "pontiac",
        status: "running",
        startedAt: now,
      },
    ]);
    expect(await canMatchSettledIngestionAlerts(database, "market", now)).toBe(
      false,
    );
    await client.execute(
      "update ingestion_run set active_slot = null, stage = 'released', status = 'error' where id = 'native'",
    );
    await client.execute(
      "update ingestion_source_run set status = 'failed', acceptance_status = 'rejected' where run_id = 'native'",
    );
    // A transient failure still has a same-day retry. The earlier publication
    // must neither query search nor advance the saved-search time window.
    expect(await canMatchSettledIngestionAlerts(database, "market", now)).toBe(
      false,
    );
    await client.execute(
      "update ingestion_source_run set validation_errors = '[\"floor\"]' where run_id = 'native'",
    );
    expect(await canMatchSettledIngestionAlerts(database, "market", now)).toBe(
      true,
    );
    expect(
      await canMatchSettledIngestionAlerts(
        database,
        "market",
        new Date("2026-11-18T12:00:00Z"),
      ),
    ).toBe(false);
    await client.execute(
      "update ingestion_source_run set validation_errors = null where run_id = 'native'",
    );
    for (const id of ["retry2", "retry3"]) {
      await database
        .insert(ingestionRun)
        .values({
          id,
          source: "pontiac",
          scheduleKey: "2026-11-17",
          status: "error",
          stage: "released",
          startedAt: now,
          lastProgressAt: now,
        });
      await database
        .insert(ingestionSourceRun)
        .values({
          id: id + ":pontiac",
          runId: id,
          source: "pontiac",
          status: "failed",
          acceptanceStatus: "rejected",
          startedAt: now,
        });
    }
    expect(await canMatchSettledIngestionAlerts(database, "market", now)).toBe(
      true,
    );
  } finally {
    cleanup();
  }
});

test("the last native publication matches after the earlier marketplace run releases", async () => {
  const { client, cleanup } = createTestClient();
  try {
    await client.executeMultiple(TEST_SCHEMA);
    const database = drizzle(client);
    for (const [id, source, activeSlot] of [
      ["market", "autorecycler", null],
      ["native", "pontiac", 1],
    ] as const) {
      await database
        .insert(ingestionRun)
        .values({
          id,
          source,
          scheduleKey: "2026-11-17",
          status: activeSlot ? "running" : "success",
          stage: activeSlot ? "match_alerts" : "released",
          activeSlot,
          searchPublishedAt: now,
          startedAt: now,
          lastProgressAt: now,
        });
      await database
        .insert(ingestionSourceRun)
        .values({
          id: id + ":" + source,
          runId: id,
          source,
          status: "success",
          acceptanceStatus: "accepted",
          startedAt: now,
        });
    }
    expect(await canMatchSettledIngestionAlerts(database, "native", now)).toBe(
      true,
    );
    await client.execute(
      "update ingestion_run set schedule_key = null where id = 'native'",
    );
    expect(await canMatchSettledIngestionAlerts(database, "native", now)).toBe(
      true,
    );
  } finally {
    cleanup();
  }
});
