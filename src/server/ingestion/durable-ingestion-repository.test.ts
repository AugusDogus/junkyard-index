import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import { IngestionSchedule } from "./ingestion-schedule";
import { createDurableIngestionRepository } from "./durable-ingestion-repository";
import type {
  DurableIngestionWakeupResult,
  FetchedDurableSourceChunk,
} from "./durable-ingestion-types";
import {
  DURABLE_INGESTION_SOURCES,
  type DurableSourceCursor,
} from "./durable-source";
import type { PypStoreCursor } from "./durable-cursor";
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
            yards: [{ ...testYard, name: vin }],
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
      expect(yards.rows.map((yard) => yard.name)).toEqual([snapshotVin]);
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
          await repository.prepareWakeup(new Date("2026-08-22T09:00:00.000Z"), [
            "pyp",
          ]),
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
                inventory_outcome = ?, search_published_at = ?, completed_at = ?
            where id = ?
          `,
          args: [outcome, now.getTime(), now.getTime(), runId],
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

      // pyp waits for row52, which outranks it and is still active.
      expect(await repository.claimCommit(second.runId)).toBe("busy");
      const claimedAt = new Date("2026-08-22T09:30:00.000Z");
      expect(await repository.claimCommit(first.runId, claimedAt)).toBe(
        "claimed",
      );
      expect(await repository.claimCommit(second.runId)).toBe("busy");
      // A resumed workflow reclaims its own commit and keeps the first stamp.
      expect(await repository.claimCommit(first.runId)).toBe("claimed");
      expect((await repository.getRun(first.runId)).commitStartedAt).toEqual(
        claimedAt,
      );
      expect(await repository.claimCommit(second.runId)).toBe("busy");

      await client.execute({
        sql: "update ingestion_run set status = 'success', stage = 'released', active_slot = null where id = ?",
        args: [first.runId],
      });
      expect(await repository.claimCommit(first.runId)).toBe("stopped");
      expect(await repository.claimCommit(second.runId)).toBe("claimed");
    } finally {
      testDatabase.cleanup();
    }
  });

  test("takes on a rebuild abandoned after it started and stamps after alert checks", async () => {
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
      expect(await repository.claimCommit(row52.runId)).toBe("claimed");
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
      // Within a second of the newest alert check, the first claim waits.
      expect(
        await repository.claimCommit(
          pyp.runId,
          new Date(lastChecked.getTime() + 999),
        ),
      ).toBe("busy");
      const claimedAt = new Date(lastChecked.getTime() + 1000);
      expect(await repository.claimCommit(pyp.runId, claimedAt)).toBe(
        "claimed",
      );
      const run = await repository.getRun(pyp.runId);
      expect(run.fullReindexRequired).toBe(true);
      expect(run.commitStartedAt).toEqual(claimedAt);
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

      // Alert matching stays resumable: abandoning it would cancel intents
      // whose searches already advanced their checkpoints.
      const matching = startedRun(
        await repository.prepareWakeup(new Date("2026-08-22T11:00:00.000Z"), [
          "pyp",
        ]),
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

  test("cleans snapshots and bounded delivery history without deleting pending work", async () => {
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

      expect(
        await repository.cleanupBatch(
          "run-cleanup",
          new Date("2023-11-20T00:00:00.000Z"),
        ),
      ).toEqual({ deleted: 3, done: true });

      expect(snapshotStore.pathnames()).toHaveLength(0);
      const changes = await client.execute(
        "select vin from vehicle_change_v2 order by vin",
      );
      expect(changes.rows.map((row) => row.vin)).toEqual(["VIN-PENDING"]);
      const intents = await client.execute(
        "select id from search_notification_intent order by id",
      );
      expect(intents.rows.map((row) => row.id)).toEqual([
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
