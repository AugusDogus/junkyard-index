import { createClient, type Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { createDurableIngestionRepository } from "./durable-ingestion-repository";
import { TEST_SCHEMA } from "./durable-ingestion-test-fixtures";
import { validateDurableSourceRuns } from "./durable-source-validation";
import { IngestionSchedule } from "./ingestion-schedule";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// 07:00 UTC opens an ingestion day.
const DAY_START = new Date("2026-11-19T07:00:00.000Z").getTime();
const at = (offsetMs: number) => new Date(DAY_START + offsetMs);

let client: Client;
let repository: ReturnType<typeof createDurableIngestionRepository>;
let validate: (
  runId: string,
  now: Date,
) => ReturnType<typeof validateDurableSourceRuns>;

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  await client.executeMultiple(TEST_SCHEMA);
  const database = drizzle(client);
  const snapshotStore = IngestionSnapshotStore.memory();
  repository = createDurableIngestionRepository(
    database,
    client,
    snapshotStore,
  );
  validate = (runId, now) =>
    validateDurableSourceRuns({
      runId,
      database,
      batchClient: client,
      snapshotStore,
      now,
    });
});

afterEach(() => client.close());

/** Another source's run that validated and holds the commit, like a long
 * Algolia rebuild. */
async function commitHolder(now: Date) {
  await client.execute({
    sql: `insert into ingestion_run (
      id, source, schedule_key, status, stage, active_slot, started_at,
      last_progress_at, ready_at, accepted_sources
    ) values ('holder', 'row52', ?, 'running', 'reconcile_upsert', 1, ?, ?, ?,
      '["row52"]')`,
    args: ["2026-11-19", now.getTime() - HOUR, now.getTime(), now.getTime()],
  });
  expect(await repository.claimCommit("holder", now)).toBe("claimed");
}

/** Starts the day's scheduled run for `source` and returns its id. */
async function scheduledRun(source: "pyp" | "upullitwa", now: Date) {
  const plan = await repository.prepareWakeup(now, [source]);
  const started =
    plan.status === "active"
      ? plan.runs.find((run) => run.action === "start")
      : undefined;
  if (!started) throw new Error(`Expected a scheduled ${source} run`);
  return started.runId;
}

async function startedSources(now: Date, sources: ("pyp" | "upullitwa")[]) {
  const plan = await repository.prepareWakeup(now, sources);
  if (plan.status !== "active") return [];
  const started = plan.runs.filter((run) => run.action === "start");
  return Promise.all(
    started.map(async (run) => (await repository.getRun(run.runId)).source),
  );
}

/** A scheduled pyp run whose crawl failed, staged while `holder` holds the
 * commit. Returns its id before validation. */
async function failedRunBehindHolder() {
  await commitHolder(at(0));
  const runId = await scheduledRun("pyp", at(0));
  await repository.markSourceFailed({
    runId,
    source: "pyp",
    message: "pyp ingestion failed: HTTP 503",
  });
  return runId;
}

describe("a run with no accepted source", () => {
  test("releases its slot at validation, so its source can retry at once while another run holds the commit", async () => {
    const runId = await failedRunBehindHolder();

    expect(await validate(runId, at(0))).toEqual({
      status: "released",
      acceptedSources: [],
      rejectedSources: [
        {
          source: "pyp",
          errors: expect.arrayContaining(["pyp ingestion failed: HTTP 503"]),
        },
      ],
    });
    expect(await repository.getRun(runId)).toMatchObject({
      status: "error",
      stage: "released",
      activeSlot: null,
      commitStartedAt: null,
      readyAt: null,
      publicationSequence: null,
      inventoryPublishedAt: null,
      fullReindexRequired: false,
    });
    // It never queued, so the commit holder is untouched.
    expect(await repository.getRun("holder")).toMatchObject({
      activeSlot: 1,
      status: "running",
    });
    expect((await repository.getCommitLeaseStatus(at(0))).waiters.total).toBe(
      0,
    );

    // The source is free right away for a retry.
    expect((await repository.startManualRun("pyp", at(MINUTE))).status).toBe(
      "started",
    );
    expect((await repository.getRun("holder")).commitStartedAt).toEqual(at(0));
  });

  test("retries on schedule after the usual delay while another run holds the commit", async () => {
    const runId = await failedRunBehindHolder();
    expect((await validate(runId, at(0))).status).toBe("released");

    // The pass waits for reports only until the retry is due.
    expect(await repository.prepareWakeup(at(HOUR), ["pyp"])).toMatchObject({
      status: "active",
      retryAt: at(IngestionSchedule.retryDelayMs).getTime(),
    });
    expect(await startedSources(at(HOUR), ["pyp"])).toEqual([]);
    expect(
      await startedSources(at(MINUTE + IngestionSchedule.retryDelayMs), [
        "pyp",
      ]),
    ).toEqual(["pyp"]);
    expect((await repository.getRun("holder")).commitStartedAt).toEqual(at(0));
  });

  test("ends a deterministic rejection's day without waiting for the commit", async () => {
    await commitHolder(at(0));
    const runId = await scheduledRun("pyp", at(0));
    await repository.markSourceFailed({
      runId,
      source: "pyp",
      message: "Pick-A-Part VA set-date search returned 500 cards",
      validationRejected: true,
    });

    expect((await validate(runId, at(0))).status).toBe("released");
    expect((await repository.getRun(runId)).activeSlot).toBeNull();
    expect(
      await startedSources(at(IngestionSchedule.retryDelayMs + MINUTE), [
        "pyp",
      ]),
    ).toEqual([]);
  });

  test("keeps no search rebuild it inherited, which stays with the run it came from", async () => {
    await client.execute({
      sql: `insert into ingestion_run (
        id, source, status, stage, active_slot, full_reindex_required,
        publication_sequence, started_at, last_progress_at, completed_at
      ) values ('owes-rebuild', 'row52', 'abandoned', 'project_changes', null, 1,
        1, ?, ?, ?)`,
      args: [at(-HOUR).getTime(), at(-HOUR).getTime(), at(-HOUR).getTime()],
    });
    const runId = await scheduledRun("pyp", at(0));
    expect((await repository.getRun(runId)).fullReindexRequired).toBe(true);
    await repository.markSourceFailed({
      runId,
      source: "pyp",
      message: "pyp ingestion failed: HTTP 503",
    });

    expect((await validate(runId, at(0))).status).toBe("released");
    expect((await repository.getRun(runId)).fullReindexRequired).toBe(false);
    expect((await repository.getRun("owes-rebuild")).fullReindexRequired).toBe(
      true,
    );
  });
});

describe("a queued snapshot", () => {
  /** A run of `scheduleKey` that validated at `readyAt` and waits for the
   * commit. */
  async function queuedRun(params: {
    id: string;
    source: string;
    scheduleKey: string | null;
    readyAt: number;
  }) {
    await client.execute({
      sql: `insert into ingestion_run (
        id, source, schedule_key, status, stage, active_slot,
        full_reindex_required, started_at, last_progress_at, ready_at,
        accepted_sources
      ) values (?, ?, ?, 'running', 'reconcile_upsert', 1, 1, ?, ?, ?, ?)`,
      args: [
        params.id,
        params.source,
        params.scheduleKey,
        params.readyAt - HOUR,
        params.readyAt,
        params.readyAt,
        JSON.stringify([params.source]),
      ],
    });
    await client.execute({
      sql: `insert into ingestion_source_run (
        id, run_id, source, status, acceptance_status, started_at
      ) values (?, ?, ?, 'success', 'accepted', ?)`,
      args: [
        `${params.id}:${params.source}`,
        params.id,
        params.source,
        params.readyAt - HOUR,
      ],
    });
  }

  test("from an earlier ingestion day gives way to the new day's crawl", async () => {
    await commitHolder(at(0));
    // Staged at 13:00 on Nov 18, still queued at Nov 19 07:00 (18 hours,
    // inside the TTL) behind the holder.
    await queuedRun({
      id: "yesterday",
      source: "pyp",
      scheduleKey: "2026-11-18",
      readyAt: at(-18 * HOUR).getTime(),
    });
    // Today's queued snapshot of another source keeps its place.
    await queuedRun({
      id: "today",
      source: "upullitwa",
      scheduleKey: "2026-11-19",
      readyAt: at(0).getTime(),
    });

    expect(await startedSources(at(MINUTE), ["pyp", "upullitwa"])).toEqual([
      "pyp",
    ]);
    const superseded = await repository.getRun("yesterday");
    expect(superseded).toMatchObject({
      status: "error",
      stage: "released",
      activeSlot: null,
      commitStartedAt: null,
      fullReindexRequired: false,
      releasedAt: at(MINUTE),
    });
    expect(superseded.errors).toContain("superseded");
    expect(
      (await repository.getSourceRuns("yesterday")).map(
        (row) => row.acceptanceStatus,
      ),
    ).toEqual(["superseded"]);
    expect(await repository.getRun("today")).toMatchObject({
      status: "running",
      activeSlot: 1,
    });
    expect(await repository.getRun("holder")).toMatchObject({
      status: "running",
      activeSlot: 1,
    });
  });

  test("from an earlier day that validated after the new day began keeps its place", async () => {
    // Nov 18's crawl ran past 07:00 on Nov 19 and validated at 08:00 behind
    // the holder. Superseding it would restart a crawl that can cross the
    // boundary again every day; it publishes when its turn comes.
    await commitHolder(at(0));
    await queuedRun({
      id: "late",
      source: "pyp",
      scheduleKey: "2026-11-18",
      readyAt: at(HOUR).getTime(),
    });

    expect(await startedSources(at(2 * HOUR), ["pyp"])).toEqual([]);
    expect(await repository.getRun("late")).toMatchObject({
      status: "running",
      activeSlot: 1,
    });
  });

  test("past the TTL is released by the pass even when no waiter attempts a claim", async () => {
    // No waiter runs the claim's expiry: every waiter's workflow died or was
    // pinned to a deployment from before the TTL (Nov 19 to Nov 20). The
    // run has no ingestion day, so only the TTL can release it.
    await commitHolder(at(0));
    await queuedRun({
      id: "stale",
      source: "pyp",
      scheduleKey: null,
      readyAt: at(-24 * HOUR - MINUTE).getTime(),
    });

    expect(await startedSources(at(0), ["pyp"])).toEqual(["pyp"]);
    const expired = await repository.getRun("stale");
    expect(expired).toMatchObject({
      status: "error",
      activeSlot: null,
      fullReindexRequired: false,
    });
    expect(expired.errors).toContain(
      "expired after waiting more than 24 hours",
    );
  });
});
