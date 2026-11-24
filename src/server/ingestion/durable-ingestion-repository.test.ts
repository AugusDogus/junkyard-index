import { describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import { IngestionSchedule } from "./ingestion-schedule";
import { reconciliationSourcePriority } from "./reconciliation-policy";
import { createDurableIngestionRepository } from "./durable-ingestion-repository";
import type {
  DurableIngestionWakeupResult,
  FetchedDurableSourceChunk,
} from "./durable-ingestion-types";
import {
  DURABLE_INGESTION_SOURCES,
  durableSourceChunkProgressError,
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
  type DurableSourceCursor,
} from "./durable-source";
import type { PypStoreCursor } from "./durable-cursor";
import { JolietCursor } from "./joliet-cursor";
import type { Yard } from "~/lib/yard";
import {
  createTestClient,
  TEST_SCHEMA,
  makeVehicle,
  stagedSnapshots,
} from "./durable-ingestion-test-fixtures";

const initialPypCursor: PypStoreCursor = {
  source: "pyp",
  storeCodes: null,
  storeIndex: 0,
  page: 0,
};

function pypCursorFromBoundary(page = 1): PypStoreCursor {
  return {
    source: "pyp",
    storeCodes: Array.from({ length: 20 }, (_, index) => String(1200 + index)),
    storeIndex: 0,
    page,
  };
}

function pypCursorAtSourceBoundary(): DurableSourceCursor {
  return pypCursorFromBoundary();
}

function mismatchedFetchFromBoundary(
  fetched: FetchedDurableSourceChunk<"pyp">,
): FetchedDurableSourceChunk {
  return {
    ...fetched,
    cursor: {
      source: "row52",
      afterLocationId: 0,
      locationIds: [],
      skip: 0,
    },
  };
}

/** The single run a wakeup started, failing the test otherwise. */
function startedRun(wakeup: DurableIngestionWakeupResult): string {
  const started =
    wakeup.status === "active"
      ? wakeup.runs.filter((run) => run.action === "start")
      : [];
  const [run] = started;
  if (!run || started.length !== 1)
    throw new Error(`Expected one started run, got ${JSON.stringify(wakeup)}`);
  return run.runId;
}

describe("durable ingestion repository", () => {
  test("checkpoints presence evidence atomically, ignores stale replays, and cleans up only released runs", async () => {
    const testDatabase = createTestClient();
    const { client } = testDatabase;
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const snapshotStore = IngestionSnapshotStore.memory();
      const repository = createDurableIngestionRepository(
        drizzle(client),
        client,
        snapshotStore,
      );
      await repository.initialize("run-observed");
      const fetched: FetchedDurableSourceChunk<"pullnsave"> = {
        cursor: { source: "pullnsave", page: 2 },
        status: "paused",
        pagesProcessed: 1,
        vehiclesProcessed: 0,
        uniqueVehicles: 0,
        duplicateVehicles: 0,
        rejectedVehicles: 0,
        errors: [],
        vehicles: [],
        yards: [],
        observedVins: ["vin-present", "VIN-PRESENT"],
      };
      const checkpoint = {
        runId: "run-observed",
        requestedCursor: { source: "pullnsave", page: 1 } as const,
        fetched,
      };
      await repository.checkpointChunk(checkpoint);
      await repository.checkpointChunk({
        ...checkpoint,
        fetched: { ...fetched, observedVins: ["VIN-STALE-REPLAY"] },
      });
      expect(
        (await stagedSnapshots(client, snapshotStore, "run-observed"))
          .observedVins,
      ).toEqual(["VIN-PRESENT"]);
      await repository.cleanupStaleSnapshots();
      await repository.cleanupBatch("run-observed");
      expect(snapshotStore.pathnames()).toHaveLength(1);

      await expect(
        repository.checkpointChunk({
          runId: "run-observed",
          requestedCursor: fetched.cursor,
          fetched: {
            ...fetched,
            cursor: { source: "pullnsave", page: 3 },
            observedVins: [""],
          },
        }),
      ).rejects.toThrow("invalid observed VIN");
      await client.execute(
        "update ingestion_run set active_slot = null, status = 'success' where id = 'run-observed'",
      );
      await repository.cleanupBatch("run-observed");
      expect(snapshotStore.pathnames()).toHaveLength(0);
      expect(
        (await stagedSnapshots(client, snapshotStore, "run-observed"))
          .observedVins,
      ).toEqual([]);
    } finally {
      testDatabase.cleanup();
    }
  });
  test("starts a manual run on a day whose attempts are used up, once at a time", async () => {
    const { client, cleanup } = createTestClient();
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const repository = createDurableIngestionRepository(
        drizzle(client),
        client,
        IngestionSnapshotStore.memory(),
      );
      for (const [index, hour] of [7, 9, 11].entries()) {
        await client.execute({
          sql: `insert into ingestion_run (
            id, source, schedule_key, status, stage, started_at, last_progress_at
          ) values (?, 'pyp', '2026-08-22', 'error', 'released', ?, ?)`,
          args: [`spent-${index}`, Date.UTC(2026, 7, 22, hour), 0],
        });
        await client.execute({
          sql: `insert into ingestion_source_run (
            id, run_id, source, status, acceptance_status, started_at
          ) values (?, ?, 'pyp', 'error', 'rejected', ?)`,
          args: [
            `spent-${index}:pyp`,
            `spent-${index}`,
            Date.UTC(2026, 7, 22, hour),
          ],
        });
      }
      const now = new Date("2026-08-22T20:00:00.000Z");
      expect(await repository.prepareWakeup(now, ["pyp"])).toEqual({
        status: "complete",
      });

      const manual = await repository.startManualRun("pyp", now);
      expect(manual.status).toBe("started");
      if (manual.status === "started") {
        const run = await repository.getRun(manual.runId);
        expect(run).toMatchObject({
          source: "pyp",
          scheduleKey: "2026-08-22",
          status: "running",
          activeSlot: 1,
        });
      }
      expect(await repository.startManualRun("pyp", now)).toEqual({
        status: "busy",
      });
    } finally {
      cleanup();
    }
  });

  test("makes the first v2 ingestion a full reindex without mutating legacy runs", async () => {
    const testDatabase = createTestClient();
    const { client } = testDatabase;
    try {
      await client.executeMultiple(TEST_SCHEMA);
      await client.execute(`
        insert into ingestion_run (
          id, source, status, stage, started_at, last_progress_at, completed_at
        ) values (
          'legacy-success', 'all', 'success', 'sources', 1000, 0, 2000
        )
      `);
      const snapshotStore = IngestionSnapshotStore.memory();
      const repository = createDurableIngestionRepository(
        drizzle(client),
        client,
        snapshotStore,
      );

      const runId = startedRun(
        await repository.prepareWakeup(new Date("2026-08-22T07:00:00.000Z"), [
          "pyp",
        ]),
      );
      expect((await repository.getRun(runId)).fullReindexRequired).toBe(true);

      const legacyRun = await client.execute(
        `select status, stage, full_reindex_required, started_at,
                last_progress_at, completed_at, publication_sequence
         from ingestion_run where id = 'legacy-success'`,
      );
      expect(legacyRun.rows[0]).toMatchObject({
        status: "success",
        stage: "sources",
        full_reindex_required: 0,
        started_at: 1000,
        last_progress_at: 0,
        completed_at: 2000,
        publication_sequence: null,
      });
    } finally {
      testDatabase.cleanup();
    }
  });

  test("checkpoints once on replay and preserves a failed execution for resumption", async () => {
    const testDatabase = createTestClient();
    const { client } = testDatabase;
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const snapshotStore = IngestionSnapshotStore.memory();
      const repository = createDurableIngestionRepository(
        drizzle(client),
        client,
        snapshotStore,
      );

      expect(await repository.initialize("run-1")).toEqual({
        status: "started",
        runId: "run-1",
        sources: DURABLE_INGESTION_SOURCES,
      });
      expect(await repository.initialize("run-1")).toEqual({
        status: "started",
        runId: "run-1",
        sources: DURABLE_INGESTION_SOURCES,
      });
      expect(
        await repository.getCheckpoint({
          runId: "run-1",
          requestedCursor: initialPypCursor,
        }),
      ).toBeNull();

      const fetched = {
        cursor: pypCursorFromBoundary(),
        status: "paused" as const,
        pagesProcessed: 1,
        vehiclesProcessed: 1,
        uniqueVehicles: 1,
        duplicateVehicles: 0,
        rejectedVehicles: 0,
        errors: [],
        vehicles: [makeVehicle()],
        yards: [],
      };
      const first = await repository.checkpointChunk({
        runId: "run-1",
        requestedCursor: initialPypCursor,
        fetched,
      });
      const replay = await repository.checkpointChunk({
        runId: "run-1",
        requestedCursor: initialPypCursor,
        fetched,
      });
      expect(first.count).toBe(1);
      expect(replay.count).toBe(1);
      expect(replay.pagesProcessed).toBe(1);

      await expect(
        repository.checkpointChunk({
          runId: "run-1",
          requestedCursor: pypCursorAtSourceBoundary(),
          fetched: mismatchedFetchFromBoundary(fetched),
        }),
      ).rejects.toThrow("Cannot checkpoint row52 cursor for pyp source run");

      await repository.markRunFailed("run-1", "reconciliation failed");
      const sourceRuns = await repository.getSourceRuns("run-1");
      expect(sourceRuns.every((row) => row.status === "running")).toBe(true);
      const run = await repository.getRun("run-1");
      expect(run.status).toBe("running");
      expect(run.executionErrors).toContain("reconciliation failed");

      expect(
        (await stagedSnapshots(client, snapshotStore, "run-1")).vins,
      ).toHaveLength(1);
    } finally {
      testDatabase.cleanup();
    }
  });

  test("commits exactly one attempt when two checkpoints race", async () => {
    const testDatabase = createTestClient();
    const { client } = testDatabase;
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const snapshotStore = IngestionSnapshotStore.memory();
      const repository = createDurableIngestionRepository(
        drizzle(client),
        client,
        snapshotStore,
      );
      await repository.initialize("run-race");

      const checkpoint = (vin: string) =>
        repository.checkpointChunk({
          runId: "run-race",
          requestedCursor: initialPypCursor,
          fetched: {
            cursor: pypCursorFromBoundary(),
            status: "paused",
            pagesProcessed: 1,
            vehiclesProcessed: 1,
            uniqueVehicles: 1,
            duplicateVehicles: 0,
            rejectedVehicles: 0,
            errors: [],
            vehicles: [makeVehicle(vin)],
            yards: [{ ...testYard, name: `Race Yard ${vin.at(-1)}` }],
          },
        });

      const [first, second] = await Promise.all([
        checkpoint("VIN-RACE-A"),
        checkpoint("VIN-RACE-B"),
      ]);
      expect(first.count).toBe(1);
      expect(second.count).toBe(1);
      expect(first.pagesProcessed).toBe(1);
      expect(second.pagesProcessed).toBe(1);

      const { vins } = await stagedSnapshots(client, snapshotStore, "run-race");
      expect(vins).toHaveLength(1);
      // The losing attempt's staged chunk is deleted, not left orphaned.
      expect(snapshotStore.pathnames()).toHaveLength(1);
      const snapshotVin = vins[0];
      expect(typeof snapshotVin).toBe("string");
      if (typeof snapshotVin !== "string") {
        throw new Error("Expected one snapshot VIN after checkpoint race");
      }
      expect(["VIN-RACE-A", "VIN-RACE-B"]).toContain(snapshotVin);
      const yards = await client.execute("select name from yard");
      expect(yards.rows.map((yard) => yard.name)).toEqual([
        `Race Yard ${snapshotVin.at(-1)}`,
      ]);
    } finally {
      testDatabase.cleanup();
    }
  });

  test("resumes orphaned runs and requires forced repair after reconciliation starts", async () => {
    const testDatabase = createTestClient();
    const { client } = testDatabase;
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const snapshotStore = IngestionSnapshotStore.memory();
      const repository = createDurableIngestionRepository(
        drizzle(client),
        client,
        snapshotStore,
      );
      const first = {
        runId: startedRun(
          await repository.prepareWakeup(new Date("2026-08-22T07:00:00.000Z"), [
            "pyp",
          ]),
        ),
      };
      expect(
        await repository.prepareWakeup(new Date("2026-08-22T08:00:00.000Z"), [
          "pyp",
        ]),
      ).toEqual({
        status: "active",
        runs: [{ action: "resume", runId: first.runId }],
      });

      await client.execute({
        sql: "update ingestion_run set stage = 'reconcile_missing' where id = ?",
        args: [first.runId],
      });
      await expect(repository.abandon(first.runId, false)).rejects.toThrow(
        "force is required",
      );
      await repository.abandon(first.runId, true);
      const abandoned = await repository.getRun(first.runId);
      expect(abandoned.status).toBe("abandoned");
      expect(abandoned.fullReindexRequired).toBe(true);

      const repair = {
        runId: startedRun(
          await repository.prepareWakeup(
            new Date(Date.now() + IngestionSchedule.retryDelayMs),
            ["pyp"],
          ),
        ),
      };
      expect((await repository.getRun(repair.runId)).fullReindexRequired).toBe(
        true,
      );
      await client.execute({
        sql: "update ingestion_run set stage = 'full_reindex_move_pending' where id = ?",
        args: [repair.runId],
      });
      await expect(repository.abandon(repair.runId, true)).rejects.toThrow(
        "has an unconfirmed Algolia index move",
      );
      await client.execute({
        sql: "update ingestion_run set stage = 'sources' where id = ?",
        args: [repair.runId],
      });
      await client.execute({
        sql: `insert into search_notification_intent (id, run_id, status)
              values ('repair-intent', ?, 'pending')`,
        args: [repair.runId],
      });
      await repository.abandon(repair.runId, false);
      expect((await repository.getRun(repair.runId)).fullReindexRequired).toBe(
        true,
      );
      const intent = await client.execute({
        sql: `select status, last_error
              from search_notification_intent where id = 'repair-intent'`,
        args: [],
      });
      expect(JSON.stringify(intent.rows[0])).toBe(
        JSON.stringify({
          status: "cancelled",
          last_error: "owning_ingestion_run_abandoned",
        }),
      );
    } finally {
      testDatabase.cleanup();
    }
  });

  test("starts a run for every due source and resumes them on later wakeups", async () => {
    const testDatabase = createTestClient();
    const { client } = testDatabase;
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const snapshotStore = IngestionSnapshotStore.memory();
      const repository = createDurableIngestionRepository(
        drizzle(client),
        client,
        snapshotStore,
      );
      const now = new Date("2026-08-22T09:00:00.000Z");
      const wakeup = await repository.prepareWakeup(now, ["row52", "pyp"]);
      if (wakeup.status !== "active") throw new Error("Expected new runs");
      expect(wakeup.runs.map((run) => run.action)).toEqual(["start", "start"]);
      const sources = await Promise.all(
        wakeup.runs.map(async (run) => {
          const initialized = await repository.initialize(
            run.runId,
            async () => {
              throw new Error("An existing run must keep its own sources");
            },
          );
          if (initialized.status !== "started")
            throw new Error("Expected each run to stay active");
          return [
            (await repository.getRun(run.runId)).source,
            initialized.sources,
          ];
        }),
      );
      expect(sources).toEqual([
        ["row52", ["row52"]],
        ["pyp", ["pyp"]],
      ]);

      expect(await repository.prepareWakeup(now, ["row52", "pyp"])).toEqual({
        status: "active",
        runs: wakeup.runs.map((run) => ({ ...run, action: "resume" })),
      });
    } finally {
      testDatabase.cleanup();
    }
  });

  test("starts no scheduled run while a local run covers every source", async () => {
    const testDatabase = createTestClient();
    const { client } = testDatabase;
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const snapshotStore = IngestionSnapshotStore.memory();
      const repository = createDurableIngestionRepository(
        drizzle(client),
        client,
        snapshotStore,
      );
      expect((await repository.initialize("local-run")).status).toBe("started");
      expect(
        await repository.prepareWakeup(new Date("2026-08-22T09:00:00.000Z"), [
          "pyp",
        ]),
      ).toEqual({
        status: "active",
        runs: [{ action: "resume", runId: "local-run" }],
      });
    } finally {
      testDatabase.cleanup();
    }
  });

  test("reads source freshness through the started_at index", async () => {
    const testDatabase = createTestClient();
    const { client } = testDatabase;
    try {
      await client.executeMultiple(`${TEST_SCHEMA}
        create index ingestion_source_run_source_idx on ingestion_source_run(source);
        create index ingestion_source_run_started_at_idx on ingestion_source_run(started_at);`);
      const queries: { sql: string; params: unknown[] }[] = [];
      const repository = createDurableIngestionRepository(
        drizzle(client, {
          logger: { logQuery: (sql, params) => queries.push({ sql, params }) },
        }),
        client,
        IngestionSnapshotStore.memory(),
      );

      await repository.getSourceFreshness(new Date("2026-11-19T12:00:00Z"));

      const [query] = queries;
      if (!query) throw new Error("getSourceFreshness ran no query.");
      const plan = await client.execute({
        sql: `explain query plan ${query.sql}`,
        args: query.params.map((param) =>
          typeof param === "number" || typeof param === "string" ? param : null,
        ),
      });
      expect(plan.rows.map((row) => String(row.detail))).toContain(
        "SEARCH ingestion_source_run USING INDEX ingestion_source_run_started_at_idx (started_at>?)",
      );
    } finally {
      testDatabase.cleanup();
    }
  });

  test("an accepted inventory publication is done for the day while search has not published it", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const repository = createDurableIngestionRepository(
        drizzle(client),
        client,
        IngestionSnapshotStore.memory(),
      );
      const now = new Date("2026-08-22T09:00:00.000Z");
      const runId = startedRun(await repository.prepareWakeup(now, ["row52"]));
      // Turso published the source, then the run released without search
      // (skipped publication) or was abandoned in a search stage.
      for (const ending of [
        "status = 'success', stage = 'released', full_reindex_required = 1",
        "status = 'abandoned', stage = 'project_changes', full_reindex_required = 1",
      ]) {
        await client.execute({
          sql: `
            update ingestion_run
            set ${ending}, active_slot = null, publication_sequence = 1,
                inventory_outcome = 'published', inventory_published_at = ?,
                search_published_at = null, completed_at = ?
            where id = ?
          `,
          args: [now.getTime(), now.getTime(), runId],
        });
        await client.execute({
          sql: "update ingestion_source_run set status = 'success', acceptance_status = 'accepted' where run_id = ?",
          args: [runId],
        });
        // No retry: the source is done today and starts no cooldown.
        expect(await repository.prepareWakeup(now, ["row52"])).toEqual({
          status: "complete",
        });
        expect(await repository.getSourceFreshness(now)).toEqual([
          {
            source: "row52",
            lastAttemptAt: now.getTime(),
            lastPublishedAt: now.getTime(),
          },
        ]);
      }
    } finally {
      client.close();
    }
  });

  test("retries a failed source on its own and completes the pass after its last attempt", async () => {
    const testDatabase = createTestClient();
    const { client } = testDatabase;
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const snapshotStore = IngestionSnapshotStore.memory();
      const repository = createDurableIngestionRepository(
        drizzle(client),
        client,
        snapshotStore,
      );
      const now = new Date("2026-08-22T09:00:00.000Z");
      const finish = async (
        runId: string,
        outcome: "published" | "published_degraded",
      ) => {
        await client.execute({
          sql: `
            update ingestion_run
            set status = 'success', stage = 'released', active_slot = null,
                full_reindex_required = 0, publication_sequence = 1,
                inventory_outcome = ?, inventory_published_at = ?,
                search_published_at = ?, completed_at = ?
            where id = ?
          `,
          args: [outcome, now.getTime(), now.getTime(), now.getTime(), runId],
        });
        await client.execute({
          sql: "update ingestion_source_run set status = 'success', acceptance_status = ? where run_id = ?",
          args: [outcome === "published" ? "accepted" : "rejected", runId],
        });
      };

      const wakeup = await repository.prepareWakeup(now, ["row52", "pyp"]);
      if (wakeup.status !== "active") throw new Error("Expected new runs");
      const [row52, pyp] = wakeup.runs;
      if (!row52 || !pyp) throw new Error("Expected two runs");
      await finish(row52.runId, "published");
      await finish(pyp.runId, "published_degraded");

      expect(
        (await repository.getSourceFreshness(now)).sort((a, b) =>
          a.source.localeCompare(b.source),
        ),
      ).toEqual([
        { source: "pyp", lastAttemptAt: now.getTime(), lastPublishedAt: null },
        {
          source: "row52",
          lastAttemptAt: now.getTime(),
          lastPublishedAt: now.getTime(),
        },
      ]);
      // row52 is done for the day; pyp waits out its retry delay.
      expect(await repository.prepareWakeup(now, ["row52", "pyp"])).toEqual({
        status: "waiting",
        retryAt: now.getTime() + IngestionSchedule.retryDelayMs,
      });
      for (
        let attempt = 2;
        attempt <= IngestionSchedule.maxAttemptsPerDay;
        attempt += 1
      ) {
        const retry = startedRun(
          await repository.prepareWakeup(
            new Date(
              now.getTime() + (attempt - 1) * IngestionSchedule.retryDelayMs,
            ),
            ["row52", "pyp"],
          ),
        );
        expect((await repository.getRun(retry)).source).toBe("pyp");
        await finish(retry, "published_degraded");
      }
      // pyp used its attempts, so today's pass is complete.
      expect(
        await repository.prepareWakeup(
          new Date(now.getTime() + 5 * IngestionSchedule.retryDelayMs),
          ["row52", "pyp"],
        ),
      ).toEqual({ status: "complete" });
    } finally {
      testDatabase.cleanup();
    }
  });

  test("lets one active run hold the commit, even after its workflow dies", async () => {
    const testDatabase = createTestClient();
    const { client } = testDatabase;
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const snapshotStore = IngestionSnapshotStore.memory();
      const repository = createDurableIngestionRepository(
        drizzle(client),
        client,
        snapshotStore,
      );
      const wakeup = await repository.prepareWakeup(
        new Date("2026-08-22T09:00:00.000Z"),
        ["row52", "pyp"],
      );
      if (wakeup.status !== "active") throw new Error("Expected new runs");
      const [first, second] = wakeup.runs;
      if (!first || !second) throw new Error("Expected two runs");

      // pyp waits for row52, which validation staged first.
      await client.execute({
        sql: "update ingestion_run set stage = 'reconcile_upsert', ready_at = ?1, last_progress_at = ?1 where id = ?2",
        args: [new Date("2026-08-22T09:10:00.000Z").getTime(), first.runId],
      });
      await client.execute({
        sql: "update ingestion_run set stage = 'reconcile_upsert', ready_at = ?1, last_progress_at = ?1 where id = ?2",
        args: [new Date("2026-08-22T09:20:00.000Z").getTime(), second.runId],
      });
      const at = (time: string) => new Date(`2026-08-22T${time}.000Z`);
      expect(await repository.claimCommit(second.runId, at("09:21:00"))).toBe(
        "busy",
      );
      const claimedAt = at("09:22:00");
      expect(await repository.claimCommit(first.runId, claimedAt)).toBe(
        "claimed",
      );
      expect(await repository.claimCommit(second.runId, at("09:23:00"))).toBe(
        "busy",
      );
      // A resumed workflow reclaims its own commit and keeps the first stamp,
      // even after its workflow was silent past the waiter liveness window.
      expect(await repository.claimCommit(first.runId, at("10:30:00"))).toBe(
        "claimed",
      );
      expect((await repository.getRun(first.runId)).commitStartedAt).toEqual(
        claimedAt,
      );
      expect(await repository.claimCommit(second.runId, at("10:31:00"))).toBe(
        "busy",
      );

      await client.execute({
        sql: "update ingestion_run set status = 'success', stage = 'released', active_slot = null where id = ?",
        args: [first.runId],
      });
      expect(await repository.claimCommit(first.runId, at("10:32:00"))).toBe(
        "stopped",
      );
      expect(await repository.claimCommit(second.runId, at("10:33:00"))).toBe(
        "claimed",
      );
    } finally {
      testDatabase.cleanup();
    }
  });

  test("takes on a rebuild abandoned after it started and stamps a second after alert checks", async () => {
    const testDatabase = createTestClient();
    const { client } = testDatabase;
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const snapshotStore = IngestionSnapshotStore.memory();
      const repository = createDurableIngestionRepository(
        drizzle(client),
        client,
        snapshotStore,
      );
      await client.execute(`
        insert into ingestion_run (
          id, source, status, stage, started_at, last_progress_at,
          publication_sequence
        ) values ('published', 'row52', 'success', 'released', 1, 1, 1)
      `);
      const wakeup = await repository.prepareWakeup(
        new Date("2026-08-22T09:00:00.000Z"),
        ["row52", "pyp"],
      );
      if (wakeup.status !== "active") throw new Error("Expected new runs");
      const [row52, pyp] = wakeup.runs;
      if (!row52 || !pyp) throw new Error("Expected two runs");
      expect((await repository.getRun(pyp.runId)).fullReindexRequired).toBe(
        false,
      );

      // row52 dies after reconciling part of its commit and is abandoned.
      expect(
        await repository.claimCommit(
          row52.runId,
          new Date("2026-08-22T09:30:00.000Z"),
        ),
      ).toBe("claimed");
      await client.execute({
        sql: "update ingestion_run set stage = 'project_changes' where id = ?",
        args: [row52.runId],
      });
      await repository.abandon(row52.runId, true);

      const lastChecked = new Date("2026-08-22T10:00:00.000Z");
      await client.execute({
        sql: "insert into saved_search (id, last_checked_at) values ('search', ?)",
        args: [lastChecked.getTime()],
      });
      // Within a second of the newest alert check, the claim is stamped in
      // the next whole second instead of waiting.
      expect(
        await repository.claimCommit(
          pyp.runId,
          new Date(lastChecked.getTime() + 999),
        ),
      ).toBe("claimed");
      const run = await repository.getRun(pyp.runId);
      expect(run.fullReindexRequired).toBe(true);
      expect(run.commitStartedAt).toEqual(
        new Date(lastChecked.getTime() + 1000),
      );
    } finally {
      testDatabase.cleanup();
    }
  });

  test("resumes a held commit even after a higher-priority run starts", async () => {
    const testDatabase = createTestClient();
    const { client } = testDatabase;
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const snapshotStore = IngestionSnapshotStore.memory();
      const repository = createDurableIngestionRepository(
        drizzle(client),
        client,
        snapshotStore,
      );
      const now = new Date("2026-08-22T09:00:00.000Z");
      const pyp = startedRun(await repository.prepareWakeup(now, ["pyp"]));
      expect(await repository.claimCommit(pyp, now)).toBe("claimed");
      const row52 = startedRun(
        await repository.prepareWakeup(now, ["row52", "pyp"]),
      );

      expect(await repository.claimCommit(row52, now)).toBe("busy");
      expect(await repository.claimCommit(pyp, now)).toBe("claimed");
    } finally {
      testDatabase.cleanup();
    }
  });

  test("inherits a full rebuild only from finished runs", async () => {
    const testDatabase = createTestClient();
    const { client } = testDatabase;
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const snapshotStore = IngestionSnapshotStore.memory();
      const repository = createDurableIngestionRepository(
        drizzle(client),
        client,
        snapshotStore,
      );
      await client.execute(`
        insert into ingestion_run (
          id, source, status, stage, started_at, last_progress_at,
          publication_sequence
        ) values ('published', 'row52', 'success', 'released', 1, 1, 1)
      `);
      await client.execute(`
        insert into ingestion_run (
          id, source, status, stage, active_slot, full_reindex_required,
          started_at, last_progress_at
        ) values ('rebuilding', 'row52', 'running', 'sources', 1, 1, 2, 2)
      `);
      const now = new Date("2026-08-22T09:00:00.000Z");
      const sibling = startedRun(await repository.prepareWakeup(now, ["pyp"]));
      expect((await repository.getRun(sibling)).fullReindexRequired).toBe(
        false,
      );

      await repository.abandon("rebuilding", true);
      const next = startedRun(
        await repository.prepareWakeup(now, ["partsgalore"]),
      );
      expect((await repository.getRun(next)).fullReindexRequired).toBe(true);
    } finally {
      testDatabase.cleanup();
    }
  });

  test("abandoning names the workflow it detached, or the status a run already ended with", async () => {
    const testDatabase = createTestClient();
    const { client } = testDatabase;
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const repository = createDurableIngestionRepository(
        drizzle(client),
        client,
        IngestionSnapshotStore.memory(),
      );
      await client.execute(`
        insert into ingestion_run (
          id, source, workflow_run_id, status, stage, active_slot,
          started_at, last_progress_at
        ) values
          ('live', 'pyp', 'wrun-live', 'running', 'sources', 1, 1, 1),
          ('done', 'row52', 'wrun-done', 'success', 'released', null, 1, 1)
      `);
      expect(await repository.abandon("live", false)).toEqual({
        status: "abandoned",
        workflowRunId: "wrun-live",
      });
      expect(await repository.abandon("live", false)).toEqual({
        status: "already_ended",
        runStatus: "abandoned",
      });
      expect(await repository.abandon("done", true)).toEqual({
        status: "already_ended",
        runStatus: "success",
      });
    } finally {
      testDatabase.cleanup();
    }
  });

  test("abandons a run after repeated execution failures", async () => {
    const testDatabase = createTestClient();
    const { client } = testDatabase;
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const snapshotStore = IngestionSnapshotStore.memory();
      const repository = createDurableIngestionRepository(
        drizzle(client),
        client,
        snapshotStore,
      );
      const runId = startedRun(
        await repository.prepareWakeup(new Date("2026-08-22T09:00:00.000Z"), [
          "pyp",
        ]),
      );
      for (let failure = 1; failure < 5; failure += 1) {
        await repository.markRunFailed(runId, "Turso unavailable");
        expect((await repository.getRun(runId)).status).toBe("running");
      }
      await repository.markRunFailed(runId, "Turso unavailable");
      const run = await repository.getRun(runId);
      expect(run.status).toBe("abandoned");
      expect(run.activeSlot).toBeNull();
      expect(run.executionFailures).toBe(5);

      // A run the previous release left matching alerts stays resumable:
      // abandoning it would cancel intents whose searches already advanced
      // their checkpoints.
      const matching = startedRun(
        await repository.prepareWakeup(
          new Date(Date.now() + IngestionSchedule.retryDelayMs),
          ["pyp"],
        ),
      );
      await client.execute({
        sql: "update ingestion_run set stage = 'match_alerts' where id = ?",
        args: [matching],
      });
      for (let failure = 1; failure <= 6; failure += 1)
        await repository.markRunFailed(matching, "Algolia unavailable");
      expect((await repository.getRun(matching)).status).toBe("running");
    } finally {
      testDatabase.cleanup();
    }
  });

  test("moves a failed full-index publish out of its critical section", async () => {
    const testDatabase = createTestClient();
    const { client } = testDatabase;
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const snapshotStore = IngestionSnapshotStore.memory();
      const repository = createDurableIngestionRepository(
        drizzle(client),
        client,
        snapshotStore,
      );
      const wakeup = {
        runId: startedRun(
          await repository.prepareWakeup(new Date("2026-08-22T07:00:00.000Z"), [
            "pyp",
          ]),
        ),
      };
      await client.execute({
        sql: "update ingestion_run set stage = 'full_reindex_publish' where id = ?",
        args: [wakeup.runId],
      });

      await repository.markRunFailed(wakeup.runId, "Algolia unavailable");

      expect((await repository.getRun(wakeup.runId)).stage).toBe(
        "full_reindex_publish_failed",
      );
      await repository.abandon(wakeup.runId, true);
      expect((await repository.getRun(wakeup.runId)).status).toBe("abandoned");
    } finally {
      testDatabase.cleanup();
    }
  });

  test("cleans a released run's snapshots and processed changes without deleting pending work", async () => {
    const testDatabase = createTestClient();
    const { client } = testDatabase;
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const snapshotStore = IngestionSnapshotStore.memory();
      const repository = createDurableIngestionRepository(
        drizzle(client),
        client,
        snapshotStore,
      );
      await repository.initialize("run-cleanup");
      await client.execute({
        sql: `
          update ingestion_run
          set status = 'success', stage = 'released', active_slot = null
          where id = 'run-cleanup'
        `,
        args: [],
      });
      await client.execute({
        sql: "update ingestion_source_run set snapshot_chunks = json_array(?) where id = 'run-cleanup:pyp'",
        args: [
          await snapshotStore.put({
            runId: "run-cleanup",
            source: "pyp",
            chunk: {
              vehicles: [makeVehicle("VIN-SNAPSHOT")],
              observedVins: [],
            },
          }),
        ],
      });
      await client.executeMultiple(`
        insert into vehicle_change_v2 (run_id, vin, change_type, processed_at)
        values ('run-cleanup', 'VIN-PROCESSED', 'upsert', 1);
        insert into vehicle_change_v2 (run_id, vin, change_type, processed_at)
        values ('run-cleanup', 'VIN-PENDING', 'upsert', null);
        insert into search_notification_intent (id, run_id, status, created_at)
        values ('old-delivered', 'run-cleanup', 'delivered', 1);
        insert into search_notification_intent (id, run_id, status, created_at)
        values ('recent-delivered', 'run-cleanup', 'delivered', 1700000000000);
        insert into search_notification_intent (id, run_id, status, created_at)
        values ('old-pending', 'run-cleanup', 'pending', 1);
      `);

      expect(await repository.cleanupBatch("run-cleanup")).toEqual({
        deleted: 2,
        done: true,
      });

      expect(snapshotStore.pathnames()).toHaveLength(0);
      const changes = await client.execute(
        "select vin from vehicle_change_v2 order by vin",
      );
      expect(changes.rows.map((row) => row.vin)).toEqual(["VIN-PENDING"]);
      const intents = await client.execute(
        "select id from search_notification_intent order by id",
      );
      // Terminal intents are purged by the daily maintenance consumer.
      expect(intents.rows.map((row) => row.id)).toEqual([
        "old-delivered",
        "old-pending",
        "recent-delivered",
      ]);
    } finally {
      testDatabase.cleanup();
    }
  });
});

const testYard: Yard = {
  source: "pyp",
  code: "1229",
  name: "Pick Your Part - Sun Valley",
  operator: "LKQ Pick Your Part",
  address: "11201 Pendleton St.",
  city: "Sun Valley",
  state: "CA",
  postalCode: "91352",
  lat: 34.2284,
  lng: -118.3929,
  websiteUrl: "https://www.pyp.com/inventory/sun-valley-1229/",
  phone: "800-962-2277",
  email: null,
};

function yardChunk(yards: Yard[]): FetchedDurableSourceChunk<"pyp"> {
  return {
    cursor: pypCursorFromBoundary(),
    status: "paused",
    pagesProcessed: 1,
    vehiclesProcessed: 0,
    uniqueVehicles: 0,
    duplicateVehicles: 0,
    rejectedVehicles: 0,
    errors: [],
    vehicles: [],
    yards,
  };
}

test("yard checkpoints upsert metadata without vehicles and ignore stale replay", async () => {
  const database = createTestClient();
  try {
    await database.client.executeMultiple(TEST_SCHEMA);
    const snapshotStore = IngestionSnapshotStore.memory();
    const repository = createDurableIngestionRepository(
      drizzle(database.client),
      database.client,
      snapshotStore,
    );
    await repository.initialize("yard-run");
    const request = {
      runId: "yard-run",
      requestedCursor: initialPypCursor,
      fetched: yardChunk([testYard]),
    };
    await repository.checkpointChunk(request);
    const stored = await database.client.execute("select * from yard");
    expect(stored.rows[0]).toMatchObject({
      source: "pyp",
      code: "1229",
      phone: testYard.phone,
      website_url: testYard.websiteUrl,
    });
    await repository.checkpointChunk({
      ...request,
      requestedCursor: pypCursorFromBoundary(),
      fetched: {
        ...yardChunk([
          { ...testYard, phone: "800-555-1234", websiteUrl: null },
        ]),
        cursor: pypCursorFromBoundary(2),
      },
    });
    await repository.checkpointChunk(request);
    const updated = await database.client.execute(
      "select phone, website_url from yard",
    );
    expect(updated.rows).toHaveLength(1);
    expect(updated.rows[0]).toMatchObject({
      phone: "800-555-1234",
      website_url: null,
    });
    await repository.checkpointChunk({
      runId: "yard-run",
      requestedCursor: {
        source: "row52",
        afterLocationId: 0,
        locationIds: [],
        skip: 0,
      },
      fetched: {
        ...yardChunk([
          { ...testYard, source: "row52", name: "Independent yard" },
        ]),
        cursor: {
          source: "row52",
          afterLocationId: 1229,
          locationIds: [],
          skip: 0,
        },
      },
    });
    expect(
      (await database.client.execute("select count(*) as count from yard"))
        .rows[0]?.count,
    ).toBe(2);
  } finally {
    database.cleanup();
  }
});

test("yard checkpoints reject mismatched sources and roll back when snapshot staging or the checkpoint fails", async () => {
  const database = createTestClient();
  try {
    await database.client.executeMultiple(TEST_SCHEMA);
    const snapshotStore = IngestionSnapshotStore.memory();
    const repository = createDurableIngestionRepository(
      drizzle(database.client),
      database.client,
      snapshotStore,
    );
    await repository.initialize("yard-failure");
    const request = {
      runId: "yard-failure",
      requestedCursor: initialPypCursor,
      fetched: yardChunk([{ ...testYard, source: "row52" }]),
    };
    await expect(repository.checkpointChunk(request)).rejects.toThrow(
      "source does not match",
    );
    const rejectingRepository = createDurableIngestionRepository(
      drizzle(database.client),
      database.client,
      {
        ...snapshotStore,
        put: async () => {
          throw new Error("snapshot rejected");
        },
      },
    );
    await expect(
      rejectingRepository.checkpointChunk({
        ...request,
        fetched: { ...yardChunk([testYard]), vehicles: [makeVehicle()] },
      }),
    ).rejects.toThrow("snapshot rejected");
    await database.client.executeMultiple(
      "create trigger reject_checkpoint before update on ingestion_source_run begin select raise(abort, 'checkpoint rejected'); end;",
    );
    await expect(
      repository.checkpointChunk({
        ...request,
        fetched: { ...yardChunk([testYard]), vehicles: [makeVehicle()] },
      }),
    ).rejects.toThrow("checkpoint rejected");
    // A failed checkpoint deletes the chunk it staged.
    expect(snapshotStore.pathnames()).toEqual([]);
    expect(
      (await database.client.execute("select count(*) as count from yard"))
        .rows[0]?.count,
    ).toBe(0);
    expect(
      await repository.getCheckpoint({
        runId: request.runId,
        requestedCursor: request.requestedCursor,
      }),
    ).toBeNull();
  } finally {
    database.cleanup();
  }
});

test("provider progress and its resume path checkpoint atomically and use normal snapshot cleanup", async () => {
  const testDatabase = createTestClient();
  const { client } = testDatabase;
  try {
    await client.executeMultiple(TEST_SCHEMA);
    const store = IngestionSnapshotStore.memory();
    const repository = createDurableIngestionRepository(
      drizzle(client),
      client,
      store,
    );
    await repository.initialize("ario-checkpoint");
    const initial = { source: "autorecycler", phase: "freshness" } as const;
    const cursor = {
      source: "autorecycler",
      phase: "ario-read",
      offset: 100,
      closing: false,
      statePath: null,
      retryAt: Date.now() + 3_600_000,
      freshness: { asOf: Date.now(), legacy: {}, eligibleYards: [] },
    } as const;
    const progress = {
      session: { key: "offline-key" },
      pages: { "0": "saved-window" },
    };
    const fetched: FetchedDurableSourceChunk<"autorecycler"> = {
      cursor: {
        ...cursor,
        freshness: { ...cursor.freshness, eligibleYards: [] },
      },
      status: "paused",
      pagesProcessed: 1,
      vehiclesProcessed: 0,
      uniqueVehicles: 0,
      duplicateVehicles: 0,
      rejectedVehicles: 0,
      errors: [],
      vehicles: [],
      yards: [],
      checkpointState: progress,
    };
    const saved = await repository.checkpointChunk({
      runId: "ario-checkpoint",
      requestedCursor: initial,
      fetched,
    });
    expect(saved.status).toBe("paused");
    expect(saved.errors).toEqual([]);
    if (saved.cursor.phase !== "ario-read" || !saved.cursor.statePath)
      throw new Error("Missing private resume path");
    expect(saved.cursor.offset).toBe(100);
    expect(saved.cursor.retryAt).toBe(cursor.retryAt);
    expect((await store.load(saved.cursor.statePath)).checkpointState).toEqual(
      progress,
    );
    expect(
      await repository.getCheckpoint({
        runId: "ario-checkpoint",
        requestedCursor: initial,
      }),
    ).toEqual(saved);
    expect(
      await repository.checkpointChunk({
        runId: "ario-checkpoint",
        requestedCursor: initial,
        fetched,
      }),
    ).toEqual(saved);
    expect(store.pathnames()).toHaveLength(1);
    await repository.cleanupStaleSnapshots();
    expect(store.pathnames()).toHaveLength(1);
    await client.execute(
      "update ingestion_run set active_slot = null, status = 'error' where id = 'ario-checkpoint'",
    );
    await repository.cleanupStaleSnapshots();
    expect(store.pathnames()).toEqual([]);
  } finally {
    testDatabase.cleanup();
  }
});

test("a restarted crawl replaces every chunk and count staged before the restart", async () => {
  const testDatabase = createTestClient();
  const { client } = testDatabase;
  try {
    await client.executeMultiple(TEST_SCHEMA);
    const store = IngestionSnapshotStore.memory();
    const repository = createDurableIngestionRepository(
      drizzle(client),
      client,
      store,
    );
    await repository.initialize("restart-run");
    const stale = {
      ...makeVehicle("1FAHP2J89EG117594"),
      source: "pullnsave" as const,
    };
    const fresh = {
      ...makeVehicle("1FAHP2J89EG117595"),
      source: "pullnsave" as const,
    };
    await repository.checkpointChunk({
      runId: "restart-run",
      requestedCursor: { source: "pullnsave", page: 1 },
      fetched: {
        cursor: { source: "pullnsave", page: 2 },
        status: "paused",
        pagesProcessed: 1,
        vehiclesProcessed: 3,
        uniqueVehicles: 1,
        duplicateVehicles: 1,
        rejectedVehicles: 1,
        errors: [],
        vehicles: [stale],
        yards: [],
        observedVins: ["VIN-STALE"],
      },
    });
    const restarted = await repository.checkpointChunk({
      runId: "restart-run",
      requestedCursor: { source: "pullnsave", page: 2 },
      fetched: {
        cursor: { source: "pullnsave", page: 3 },
        status: "paused",
        restart: true,
        pagesProcessed: 1,
        vehiclesProcessed: 1,
        uniqueVehicles: 1,
        duplicateVehicles: 0,
        rejectedVehicles: 0,
        errors: [],
        vehicles: [fresh],
        yards: [],
        observedVins: [],
      },
    });
    expect(restarted).toMatchObject({
      count: 1,
      uniqueVehicles: 1,
      duplicateVehicles: 0,
      rejectedVehicles: 0,
      pagesProcessed: 2,
    });
    const staged = await stagedSnapshots(client, store, "restart-run");
    expect(staged.vins).toEqual([fresh.vin]);
    expect(staged.observedVins).toEqual([]);
    // Superseded chunks stay registered for normal run cleanup.
    expect(store.pathnames()).toHaveLength(2);

    // A restart that stages nothing still supersedes everything before it.
    const empty = await repository.checkpointChunk({
      runId: "restart-run",
      requestedCursor: { source: "pullnsave", page: 3 },
      fetched: {
        cursor: { source: "pullnsave", page: 4 },
        status: "paused",
        restart: true,
        pagesProcessed: 1,
        vehiclesProcessed: 0,
        uniqueVehicles: 0,
        duplicateVehicles: 0,
        rejectedVehicles: 0,
        errors: [],
        vehicles: [],
        yards: [],
        observedVins: [],
      },
    });
    expect(empty).toMatchObject({ count: 0, uniqueVehicles: 0 });
    expect((await stagedSnapshots(client, store, "restart-run")).vins).toEqual(
      [],
    );
    const appended = await repository.checkpointChunk({
      runId: "restart-run",
      requestedCursor: { source: "pullnsave", page: 4 },
      fetched: {
        cursor: { source: "pullnsave", page: 5 },
        status: "paused",
        pagesProcessed: 1,
        vehiclesProcessed: 1,
        uniqueVehicles: 1,
        duplicateVehicles: 0,
        rejectedVehicles: 0,
        errors: [],
        vehicles: [fresh],
        yards: [],
        observedVins: [],
      },
    });
    expect(appended).toMatchObject({ count: 1, pagesProcessed: 4 });
    expect((await stagedSnapshots(client, store, "restart-run")).vins).toEqual([
      fresh.vin,
    ]);
  } finally {
    testDatabase.cleanup();
  }
});

test("a Joliet checkpoint written before restarts existed resumes and advances", async () => {
  const testDatabase = createTestClient();
  const { client } = testDatabase;
  try {
    await client.executeMultiple(TEST_SCHEMA);
    const repository = createDurableIngestionRepository(
      drizzle(client),
      client,
      IngestionSnapshotStore.memory(),
    );
    await repository.initialize("old-joliet-run", async () => ["joliet"]);
    const receipt = (hash: string) => ({ hash, count: 0, newStocks: 0 });
    const progress = {
      contextHash: "c".repeat(64),
      pairCount: 3,
      seen: [],
    };
    // The exact wire main wrote: no restarts key, schema key order.
    const first = JolietCursor.checkpoint({
      ...progress,
      restarts: 0,
      nextQuery: 1,
      receipts: [receipt("a".repeat(64))],
    });
    if (first.phase !== "queries") throw new Error("Expected query cursor");
    const oldWire = JSON.stringify({
      phase: "queries",
      contextHash: first.contextHash,
      progressHash: first.progressHash,
      nextQuery: first.nextQuery,
      pairCount: first.pairCount,
      seen: first.seen,
      receipts: first.receipts,
    });
    await client.execute({
      sql: "update ingestion_source_run set next_cursor = ? where id = ?",
      args: [oldWire, "old-joliet-run:joliet"],
    });
    const requestedCursor = parseDurableSourceCursor("joliet", oldWire);
    expect(serializeDurableSourceCursor(requestedCursor)).toBe(oldWire);
    const next = JolietCursor.checkpoint({
      ...progress,
      restarts: 0,
      nextQuery: 2,
      receipts: [receipt("a".repeat(64)), receipt("b".repeat(64))],
    });
    const result = await repository.checkpointChunk({
      runId: "old-joliet-run",
      requestedCursor,
      fetched: {
        cursor: next,
        status: "paused",
        pagesProcessed: 1,
        vehiclesProcessed: 0,
        uniqueVehicles: 0,
        duplicateVehicles: 0,
        rejectedVehicles: 0,
        errors: [],
        vehicles: [],
        yards: [],
        observedVins: [],
      },
    });
    expect(result).toMatchObject({
      status: "paused",
      cursor: next,
      pagesProcessed: 1,
    });
    expect(durableSourceChunkProgressError(requestedCursor, result)).toBeNull();
  } finally {
    testDatabase.cleanup();
  }
});

test("a first claim inside a daily alert check's window is stamped past it", async () => {
  const { client, cleanup } = createTestClient();
  try {
    await client.executeMultiple(TEST_SCHEMA);
    const repository = createDurableIngestionRepository(
      drizzle(client),
      client,
      IngestionSnapshotStore.memory(),
    );
    const now = new Date("2026-11-20T18:00:00.000Z");
    const runId = startedRun(await repository.prepareWakeup(now, ["pyp"]));
    await client.execute({
      sql: "update ingestion_run set stage = 'reconcile_upsert' where id = ?",
      args: [runId],
    });
    const checkedThrough = new Date("2026-11-20T17:58:59.999Z");
    await client.execute({
      sql: `insert into search_alert_check
        (id, day, status, checked_through, started_at, last_progress_at)
        values ('check', '2026-11-20', 'running', ?, ?, ?)`,
      args: [checkedThrough.getTime(), now.getTime(), now.getTime()],
    });
    // Stamped now, its vehicles would fall inside the check's matched
    // window. The claim goes ahead, stamped in the next whole second.
    expect(await repository.claimCommit(runId, checkedThrough)).toBe("claimed");
    expect((await repository.getRun(runId)).commitStartedAt).toEqual(
      new Date(checkedThrough.getTime() + 1),
    );
  } finally {
    cleanup();
  }
});

test("a fetching native source does not delay AutoRecycler publication; a native run ready later waits its turn", async () => {
  const { client, cleanup } = createTestClient();
  try {
    await client.executeMultiple(TEST_SCHEMA);
    const repository = createDurableIngestionRepository(
      drizzle(client),
      client,
      IngestionSnapshotStore.memory(),
    );
    const now = new Date("2026-11-17T08:00:00Z");
    const native = startedRun(await repository.prepareWakeup(now, ["pontiac"]));
    const mirror = startedRun(
      await repository.prepareWakeup(now, ["pontiac", "autorecycler"]),
    );
    expect(reconciliationSourcePriority("pontiac")).toBeLessThan(
      reconciliationSourcePriority("autorecycler"),
    );
    await client.execute({
      sql: "update ingestion_run set stage = 'reconcile_upsert', ready_at = ? where id = ?",
      args: [now.getTime(), mirror],
    });
    expect(await repository.claimCommit(mirror, now)).toBe("claimed");
    await client.execute({
      sql: "update ingestion_run set commit_started_at = null where id = ?",
      args: [mirror],
    });
    await client.execute({
      sql: "update ingestion_run set stage = 'reconcile_upsert', ready_at = ? where id = ?",
      args: [now.getTime() + 60_000, native],
    });
    // Priority decides VIN ownership, not queue order.
    const later = new Date(now.getTime() + 2 * 60_000);
    expect(await repository.claimCommit(native, later)).toBe("busy");
    expect(await repository.claimCommit(mirror, later)).toBe("claimed");
  } finally {
    cleanup();
  }
});

test.each(["autorecycler", "harrys", "budget"] as const)(
  "first-deploy %s can commit while URG and the other higher-priority sources are fetching",
  async (source) => {
    const { client, cleanup } = createTestClient();
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const database = drizzle(client);
      const repository = createDurableIngestionRepository(
        database,
        client,
        IngestionSnapshotStore.memory(),
      );
      const now = new Date("2026-11-17T08:00:00Z");
      const wakeup = await repository.prepareWakeup(now);
      if (wakeup.status !== "active")
        throw new Error("Expected first-deploy runs");
      const runs = await Promise.all(
        wakeup.runs.map((run) => repository.getRun(run.runId)),
      );
      expect(runs).toHaveLength(DURABLE_INGESTION_SOURCES.length);
      expect(runs.every((run) => run.stage === "sources")).toBe(true);
      const ready = runs.find((run) => run.source === source);
      const urg = runs.find((run) => run.source === "urgiis");
      if (!ready || !urg) throw new Error("Expected marketplace and URG runs");
      expect(reconciliationSourcePriority("urgiis")).toBeLessThan(
        reconciliationSourcePriority(source),
      );
      await client.execute({
        sql: "update ingestion_run set stage = 'reconcile_upsert' where id = ?",
        args: [ready.id],
      });
      const readyAt = new Date(now.getTime() + 5 * 60_000);
      expect(await repository.claimCommit(ready.id, readyAt)).toBe("claimed");
      expect(await repository.getRun(urg.id)).toMatchObject({
        stage: "sources",
        status: "running",
        activeSlot: 1,
      });
    } finally {
      cleanup();
    }
  },
);

test.each(["2026-11-17", "2026-11-16"])(
  "a long failed run on %s waits after release, including across ingestion days",
  async (key) => {
    const { client, cleanup } = createTestClient();
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const repository = createDurableIngestionRepository(
        drizzle(client),
        client,
        IngestionSnapshotStore.memory(),
      );
      const now = new Date("2026-11-17T08:00:00Z");
      const runId = startedRun(await repository.prepareWakeup(now, ["pyp"]));
      await client.execute({
        sql: "update ingestion_run set status = 'success', stage = 'released', active_slot = null, schedule_key = ?, completed_at = ? where id = ?",
        args: [key, now.getTime(), runId],
      });
      await client.execute({
        sql: "update ingestion_source_run set status = 'error', acceptance_status = 'rejected', started_at = ?, completed_at = ? where run_id = ?",
        args: [now.getTime() - 5 * 3600_000, now.getTime(), runId],
      });
      expect(await repository.prepareWakeup(now, ["pyp"])).toEqual({
        status: "waiting",
        retryAt: now.getTime() + IngestionSchedule.retryDelayMs,
      });
      expect(
        (
          await repository.prepareWakeup(
            new Date(now.getTime() + IngestionSchedule.retryDelayMs),
            ["pyp"],
          )
        ).status,
      ).toBe("active");
    } finally {
      cleanup();
    }
  },
);

test("a deterministic rejection stops the day's recrawls while an explicit manual run is allowed", async () => {
  const { client, cleanup } = createTestClient();
  try {
    await client.executeMultiple(TEST_SCHEMA);
    const repository = createDurableIngestionRepository(
      drizzle(client),
      client,
      IngestionSnapshotStore.memory(),
    );
    const now = new Date("2026-11-17T08:00:00Z");
    const runId = startedRun(await repository.prepareWakeup(now, ["pyp"]));
    await client.execute({
      sql: "update ingestion_run set status = 'success', stage = 'released', active_slot = null where id = ?",
      args: [runId],
    });
    await client.execute({
      sql: "update ingestion_source_run set status = 'success', acceptance_status = 'rejected', validation_errors = ? where run_id = ?",
      args: [JSON.stringify(["pyp rejection ratio exceeds 10%"]), runId],
    });
    expect(
      await repository.prepareWakeup(new Date(now.getTime() + 3 * 3600_000), [
        "pyp",
      ]),
    ).toEqual({ status: "complete" });
    expect((await repository.startManualRun("pyp", now)).status).toBe(
      "started",
    );
  } finally {
    cleanup();
  }
});
