import { createClient, type Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { createDurableIngestionRepository } from "./durable-ingestion-repository";
import { TEST_SCHEMA } from "./durable-ingestion-test-fixtures";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import {
  reconciliationSourcePriority,
  reconciliationSourcePrioritySql,
} from "./reconciliation-policy";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const T0 = new Date("2026-11-20T12:00:00.000Z").getTime();
const at = (offsetMs: number) => new Date(T0 + offsetMs);

// Pontiac is a native feed that outranks its AutoRecycler copy.
const HIGH = "pontiac";
const LOW = "autorecycler";

let client: Client;
let repository: ReturnType<typeof createDurableIngestionRepository>;

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  await client.executeMultiple(TEST_SCHEMA);
  repository = createDurableIngestionRepository(
    drizzle(client),
    client,
    IngestionSnapshotStore.memory(),
  );
});

afterEach(() => client.close());

/** A run that validation staged at `readyAt`, waiting for the commit. */
async function stagedRun(params: {
  id: string;
  source: string;
  readyAt: number;
  lastProgressAt?: number;
  /** Earlier code validated without recording ready_at. */
  legacy?: boolean;
}) {
  await client.execute({
    sql: `insert into ingestion_run (
      id, source, status, stage, active_slot, started_at, last_progress_at,
      ready_at, accepted_sources
    ) values (?, ?, 'running', 'reconcile_upsert', 1, ?, ?, ?, ?)`,
    args: [
      params.id,
      params.source,
      params.readyAt - HOUR,
      params.lastProgressAt ?? params.readyAt,
      params.legacy ? null : params.readyAt,
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

async function release(id: string) {
  await client.execute({
    sql: "update ingestion_run set status = 'success', stage = 'released', active_slot = null where id = ?",
    args: [id],
  });
}

async function holders(): Promise<string[]> {
  const result = await client.execute(
    "select id from ingestion_run where active_slot = 1 and commit_started_at is not null",
  );
  return result.rows.map((row) => String(row.id));
}

/**
 * The claim that workflows pinned to deployments before the FIFO lease still
 * run, verbatim from main at 5d2ef21b (durable-ingestion-repository.ts).
 */
async function legacyClaim(
  runId: string,
  source: string,
  now: Date,
): Promise<"claimed" | "busy" | "stopped"> {
  const [result] = await client.batch(
    [
      {
        sql: `
          update ingestion_run
          set full_reindex_required = case
                when commit_started_at is null and exists (
                  select 1 from ingestion_run finished
                  where finished.full_reindex_required = 1
                    and finished.active_slot is null
                ) then 1
                else full_reindex_required
              end,
              commit_started_at = coalesce(commit_started_at, ?),
              last_progress_at = ?
          where id = ? and status = 'running' and active_slot = 1
            and not exists (
              select 1 from ingestion_run other
              where other.id <> ? and other.active_slot = 1
                and other.commit_started_at is not null
            )
            and (commit_started_at is not null or (
              not exists (
                select 1 from ingestion_run other
                where other.id <> ? and other.active_slot = 1
                  and other.stage <> 'sources'
                  and (${reconciliationSourcePrioritySql("other")}) < ?
              )
              and ? >= (
                select coalesce(max(last_checked_at), 0) + 1000
                from saved_search
              )
              and ? > (
                select coalesce(max(checked_through), 0)
                from search_alert_check
              )
            ))
        `,
        args: [
          now.getTime(),
          now.getTime(),
          runId,
          runId,
          runId,
          reconciliationSourcePriority(source),
          now.getTime(),
          now.getTime(),
        ],
      },
    ],
    "write",
  );
  if (result?.rowsAffected === 1) return "claimed";
  const run = await client.execute({
    sql: "select 1 from ingestion_run where id = ? and status = 'running' and active_slot = 1",
    args: [runId],
  });
  return run.rows.length === 1 ? "busy" : "stopped";
}

describe("commit lease", () => {
  test("waiters claim in the order they became ready, not by source priority", async () => {
    expect(reconciliationSourcePriority(HIGH)).toBeLessThan(
      reconciliationSourcePriority(LOW),
    );
    await stagedRun({ id: "low", source: LOW, readyAt: T0 });
    await stagedRun({ id: "high", source: HIGH, readyAt: T0 + MINUTE });

    expect(await repository.claimCommit("high", at(2 * MINUTE))).toBe("busy");
    expect(await repository.claimCommit("low", at(2 * MINUTE))).toBe("claimed");
    await release("low");
    expect(await repository.claimCommit("high", at(3 * MINUTE))).toBe(
      "claimed",
    );
  });

  test("a dead head of the queue is skipped and keeps its place when it resumes", async () => {
    // The head's workflow died right after validation; the next waiter
    // keeps recording busy attempts.
    await stagedRun({ id: "dead", source: HIGH, readyAt: T0 });
    await stagedRun({ id: "next", source: LOW, readyAt: T0 + MINUTE });
    await stagedRun({ id: "last", source: "row52", readyAt: T0 + 2 * MINUTE });

    expect(await repository.claimCommit("next", at(14 * MINUTE))).toBe("busy");
    // A busy attempt records progress, so this waiter stays live.
    expect((await repository.getRun("next")).lastProgressAt).toEqual(
      at(14 * MINUTE),
    );
    expect(await repository.claimCommit("next", at(15 * MINUTE + 1))).toBe(
      "claimed",
    );
    expect(await repository.claimCommit("last", at(20 * MINUTE))).toBe("busy");
    await release("next");

    // A resumed workflow rejoins at its original place, ahead of the live
    // waiter that became ready after it.
    expect(await repository.claimCommit("dead", at(25 * MINUTE))).toBe(
      "claimed",
    );
    expect(await repository.claimCommit("last", at(26 * MINUTE))).toBe("busy");
  });

  test("stamps each claim a later whole second than the previous holder", async () => {
    await stagedRun({ id: "first", source: LOW, readyAt: T0 });
    await stagedRun({ id: "second", source: HIGH, readyAt: T0 + 1 });
    expect(await repository.claimCommit("first", at(400))).toBe("claimed");
    await release("first");

    // The second claim lands in the same second; it is not delayed, only
    // stamped in the next one so its vehicles stay disjoint from the first.
    expect(await repository.claimCommit("second", at(700))).toBe("claimed");
    expect((await repository.getRun("first")).commitStartedAt).toEqual(at(400));
    expect((await repository.getRun("second")).commitStartedAt).toEqual(
      at(1000),
    );
  });

  test("expires a staged snapshot older than 24 hours and keeps the prior inventory", async () => {
    await client.executeMultiple(`
      create table vehicle (
        vin text primary key, source text not null, missing_since_at integer
      );
      insert into vehicle (vin, source) values ('PRIOR', '${LOW}');
    `);
    await stagedRun({ id: "stale", source: LOW, readyAt: T0 - 24 * HOUR - 1 });
    await stagedRun({ id: "older", source: HIGH, readyAt: T0 - 30 * HOUR });
    await stagedRun({ id: "fresh", source: "row52", readyAt: T0 - HOUR });

    expect(await repository.claimCommit("stale", at(0))).toBe("stopped");
    // The same attempt released the other expired waiter, so the fresh run
    // is first in line.
    expect(await repository.claimCommit("fresh", at(0))).toBe("claimed");

    for (const id of ["stale", "older"]) {
      const run = await repository.getRun(id);
      expect(run).toMatchObject({
        status: "error",
        stage: "released",
        activeSlot: null,
        commitStartedAt: null,
        publicationSequence: null,
        releasedAt: at(0),
      });
      expect(run.errors).toContain("staged snapshot expired");
      expect(
        (await repository.getSourceRuns(id)).map((row) => row.acceptanceStatus),
      ).toEqual(["expired"]);
    }
    const prior = await client.execute(
      "select vin, missing_since_at from vehicle",
    );
    expect(prior.rows).toEqual([
      expect.objectContaining({ vin: "PRIOR", missing_since_at: null }),
    ]);
    // The source's slot is free for a new crawl.
    expect((await repository.startManualRun(LOW, at(0))).status).toBe(
      "started",
    );
  });

  test("never expires the commit holder, however long ago it was staged", async () => {
    await stagedRun({ id: "holder", source: LOW, readyAt: T0 - 30 * HOUR });
    await stagedRun({ id: "fresh", source: HIGH, readyAt: T0 - HOUR });
    expect(await repository.claimCommit("holder", at(-29 * HOUR))).toBe(
      "claimed",
    );

    // Both the holder's ready_at and its last progress are past the TTL.
    expect(await repository.claimCommit("fresh", at(0))).toBe("busy");
    expect(await repository.getRun("holder")).toMatchObject({
      status: "running",
      activeSlot: 1,
      commitStartedAt: at(-29 * HOUR),
    });
    expect(
      (await repository.getSourceRuns("holder")).map(
        (row) => row.acceptanceStatus,
      ),
    ).toEqual(["accepted"]);
    expect(await holders()).toEqual(["holder"]);
  });

  test("never expires a run still fetching its sources", async () => {
    // A crawl whose last checkpoint was more than 24 hours ago is governed
    // by the fetch deferral limits, not the staged-snapshot TTL.
    await client.execute({
      sql: `insert into ingestion_run (
        id, source, status, stage, active_slot, started_at, last_progress_at
      ) values ('crawling', ?, 'running', 'sources', 1, ?, ?)`,
      args: [HIGH, T0 - 30 * HOUR, T0 - 25 * HOUR],
    });
    await stagedRun({ id: "fresh", source: LOW, readyAt: T0 - HOUR });

    expect(await repository.claimCommit("fresh", at(0))).toBe("claimed");
    expect(await repository.getRun("crawling")).toMatchObject({
      status: "running",
      stage: "sources",
      activeSlot: 1,
      releasedAt: null,
    });
  });

  test("keeps one holder across pinned priority claims and FIFO claims", async () => {
    // A waiter validated by a pinned deployment: no ready_at, and its busy
    // claims record no progress.
    await stagedRun({ id: "pinned", source: HIGH, readyAt: T0, legacy: true });
    await stagedRun({ id: "current", source: LOW, readyAt: T0 + MINUTE });

    // While the pinned waiter could still be live, it is ahead in the queue,
    // and its own claim waits for nothing ranked above it.
    expect(await repository.claimCommit("current", at(10 * MINUTE))).toBe(
      "busy",
    );
    expect(await legacyClaim("pinned", HIGH, at(10 * MINUTE))).toBe("claimed");
    expect(await repository.claimCommit("current", at(11 * MINUTE))).toBe(
      "busy",
    );
    expect(await holders()).toEqual(["pinned"]);
    await release("pinned");

    // A FIFO holder blocks a pinned claimer, whatever its priority.
    await stagedRun({
      id: "pinned-2",
      source: "row52",
      readyAt: T0 + 2 * MINUTE,
      legacy: true,
    });
    expect(await repository.claimCommit("current", at(12 * MINUTE))).toBe(
      "claimed",
    );
    expect(await legacyClaim("pinned-2", "row52", at(12 * MINUTE))).toBe(
      "busy",
    );
    expect(await holders()).toEqual(["current"]);
    await release("current");

    // A pinned waiter that never records progress stops blocking FIFO
    // waiters 15 minutes after validation.
    await stagedRun({
      id: "current-2",
      source: "partsgalore",
      readyAt: T0 + 3 * MINUTE,
    });
    expect(
      await repository.claimCommit("current-2", at(2 * MINUTE + 15 * MINUTE)),
    ).toBe("busy");
    expect(
      await repository.claimCommit(
        "current-2",
        at(2 * MINUTE + 15 * MINUTE + 1),
      ),
    ).toBe("claimed");
    expect(await legacyClaim("pinned-2", "row52", at(18 * MINUTE))).toBe(
      "busy",
    );
    expect(await holders()).toEqual(["current-2"]);
  });

  test("expires a pinned waiter's stale snapshot before its priority claim can publish it", async () => {
    await stagedRun({
      id: "pinned",
      source: HIGH,
      readyAt: T0 - 25 * HOUR,
      legacy: true,
    });
    await stagedRun({ id: "current", source: LOW, readyAt: T0 - MINUTE });

    expect(await repository.claimCommit("current", at(0))).toBe("claimed");
    await release("current");
    expect(await legacyClaim("pinned", HIGH, at(MINUTE))).toBe("stopped");
    expect(await repository.getRun("pinned")).toMatchObject({
      status: "error",
      activeSlot: null,
      commitStartedAt: null,
    });
  });

  test("reports the holder and the oldest waiter", async () => {
    await stagedRun({ id: "holder", source: LOW, readyAt: T0 });
    await stagedRun({ id: "queued", source: HIGH, readyAt: T0 + MINUTE });
    await stagedRun({
      id: "silent",
      source: "row52",
      readyAt: T0 + 2 * MINUTE,
    });
    expect(await repository.claimCommit("holder", at(3 * MINUTE))).toBe(
      "claimed",
    );
    expect(await repository.claimCommit("queued", at(19 * MINUTE))).toBe(
      "busy",
    );

    expect(await repository.getCommitLeaseStatus(at(20 * MINUTE))).toEqual({
      checkedAt: at(20 * MINUTE).toISOString(),
      holder: {
        runId: "holder",
        source: LOW,
        stage: "reconcile_upsert",
        commitStartedAt: at(3 * MINUTE).toISOString(),
        heldMs: 17 * MINUTE,
        lastProgressAgeMs: 17 * MINUTE,
      },
      waiters: {
        total: 2,
        live: 1,
        oldest: {
          runId: "queued",
          source: HIGH,
          readyAt: at(MINUTE).toISOString(),
          waitingMs: 19 * MINUTE,
          live: true,
        },
      },
    });
  });
});
