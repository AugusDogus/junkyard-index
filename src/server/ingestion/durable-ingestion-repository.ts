import { loadIngestionSourceDays } from "./ingestion-source-days";
import { createDurableWorkflowCursorStore } from "./durable-workflow-cursor-store";
import { IngestionDay } from "./ingestion-day";
import type { Client, InStatement } from "@libsql/client";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { Yard } from "~/lib/yard";
import { yardUpsertStatement } from "./yard-checkpoint";
import { ingestionRun, ingestionSourceRun } from "~/schema";
import type {
  DurableSourceChunkResult,
  DurableIngestionWakeupResult,
  DurableIngestionWakeupRun,
  FetchedDurableSourceChunk,
  InitializeDurableIngestionResult,
} from "./durable-ingestion-types";
import {
  DURABLE_INGESTION_SOURCES,
  durableSourceCursorEquals,
  getDurableSourceDefinition,
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
  type DurableCursorFor,
  type DurableIngestionSource,
} from "./durable-source";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import {
  IngestionSnapshotCleanup,
  parseSnapshotChunks,
  SNAPSHOT_CLEANUP_BUDGET_MS,
  type StaleSnapshotCleanup,
} from "./ingestion-snapshot-cleanup";
import { IngestionSchedule } from "./ingestion-schedule";
import { SourcePublication } from "./source-publication";
import { CommitLease } from "./commit-lease";
import { RunAbandonment, type RunAbandonmentResult } from "./run-abandonment";
import {
  loadSourceFreshness,
  type IngestionSourceFreshness,
} from "./durable-health";

const SNAPSHOT_WRITE_BATCH_SIZE = 500;
const CLEANUP_BATCH_SIZE = 5_000;
const MAX_EXECUTION_FAILURES = 5;
const CONCURRENT_WAKEUP_RECHECK_MS = 5 * 60 * 1000;

type SourceRunStatus = "running" | "success" | "partial" | "error";

/** Who holds the shared commit and how long the oldest waiter has queued. */
export interface CommitLeaseStatus {
  checkedAt: string;
  holder: {
    runId: string;
    source: string;
    stage: string;
    commitStartedAt: string;
    heldMs: number;
    lastProgressAgeMs: number;
  } | null;
  waiters: {
    total: number;
    /** Waiters that attempted a claim within the liveness window. */
    live: number;
    oldest: {
      runId: string;
      source: string;
      readyAt: string;
      waitingMs: number;
      live: boolean;
    } | null;
  };
}
type LibSqlBatchClient = Pick<Client, "batch">;

function sourceRunId(runId: string, source: DurableIngestionSource): string {
  return `${runId}:${source}`;
}

function sourceRunInsertStatement(
  runId: string,
  source: DurableIngestionSource,
  startedAt: Date,
): InStatement {
  const initialCursor = getDurableSourceDefinition(source).initialCursor;
  const cursor = serializeDurableSourceCursor(initialCursor);
  return {
    sql: `
      insert into ingestion_source_run (
        id, run_id, source, status, start_cursor, next_cursor, started_at
      )
      select ?, ?, ?, 'running', ?, ?, ?
      where exists (
        select 1 from ingestion_run
        where id = ? and status = 'running' and active_slot = 1
      )
      on conflict(id) do nothing
    `,
    args: [
      sourceRunId(runId, initialCursor.source),
      runId,
      initialCursor.source,
      cursor,
      cursor,
      startedAt.getTime(),
      runId,
    ],
  };
}

export function parseIngestionErrors(errorsJson: string | null): string[] {
  if (!errorsJson) return [];
  try {
    const parsed: unknown = JSON.parse(errorsJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

function deduplicateErrors(errors: readonly string[]): string[] {
  return [...new Set(errors)];
}

function statusForFailedSource(vehiclesProcessed: number): SourceRunStatus {
  return vehiclesProcessed > 0 ? "partial" : "error";
}

function toChunkResult<Source extends DurableIngestionSource>(
  source: Source,
  row: typeof ingestionSourceRun.$inferSelect,
): DurableSourceChunkResult<Source> {
  return {
    cursor: parseDurableSourceCursor(
      source,
      row.nextCursor ??
        serializeDurableSourceCursor(
          getDurableSourceDefinition(source).initialCursor,
        ),
    ),
    status:
      row.status === "running"
        ? "paused"
        : row.status === "success"
          ? "complete"
          : "failed",
    count: row.vehiclesProcessed,
    uniqueVehicles: row.uniqueVehicles,
    duplicateVehicles: row.duplicateVehicles,
    rejectedVehicles: row.rejectedVehicles,
    pagesProcessed: row.pagesProcessed,
    errors: parseIngestionErrors(row.errors),
  };
}

export { parseSnapshotChunks } from "./ingestion-snapshot-cleanup";

/**
 * The separate checkpoint state blob a cursor resumes from, when this source
 * run registered it. Null for any other statePath, such as a chunk staged
 * before checkpoint state had its own blobs or another run's census.
 */
function supersededStatePath(
  cursor: object,
  snapshotChunks: string,
): string | null {
  const statePath = "statePath" in cursor ? cursor.statePath : null;
  return typeof statePath === "string" &&
    IngestionSnapshotStore.isCheckpointStatePath(statePath) &&
    parseSnapshotChunks(snapshotChunks).includes(statePath)
    ? statePath
    : null;
}

export function createDurableIngestionRepository(
  database: LibSQLDatabase,
  batchClient: LibSqlBatchClient,
  snapshotStore: IngestionSnapshotStore,
) {
  const workflowCursors = createDurableWorkflowCursorStore(
    database,
    snapshotStore,
  );

  /**
   * Whether a checkpoint batch whose outcome is unknown registered these
   * staged blobs. The batch is atomic, so they are all registered or none.
   * Unknown when the source run cannot be read back.
   */
  async function stagedRegistration(
    id: string,
    staged: readonly string[],
  ): Promise<"registered" | "absent" | "unknown"> {
    const first = staged[0];
    if (first === undefined) return "absent";
    try {
      const [row] = await database
        .select({ snapshotChunks: ingestionSourceRun.snapshotChunks })
        .from(ingestionSourceRun)
        .where(eq(ingestionSourceRun.id, id))
        .limit(1);
      if (!row) return "unknown";
      return parseSnapshotChunks(row.snapshotChunks).includes(first)
        ? "registered"
        : "absent";
    } catch (error) {
      console.error(
        `Could not read source run ${id} back after its checkpoint batch failed.`,
        error,
      );
      return "unknown";
    }
  }

  /**
   * Creates a running run for one source unless that source (or an
   * all-source run) already has an active run. Returns the new run's id.
   */
  async function startSourceRun(
    source: DurableIngestionSource,
    scheduleKey: string,
    now: Date,
  ): Promise<string | null> {
    const runId = crypto.randomUUID();
    const [created] = await batchClient.batch(
      [
        {
          sql: `
            insert into ingestion_run (
              id, source, schedule_key, status, stage, active_slot,
              full_reindex_required, started_at, last_progress_at
            )
            select ?, ?, ?, 'running', 'sources', 1,
              case when exists (
                select 1 from ingestion_run
                where full_reindex_required = 1 and active_slot is null
              ) or not exists (
                select 1 from ingestion_run
                where publication_sequence is not null
              ) then 1 else 0 end,
              ?, ?
            where not exists (
              select 1 from ingestion_run
              where active_slot = 1 and source in (?, 'all')
            )
          `,
          args: [
            runId,
            source,
            scheduleKey,
            now.getTime(),
            now.getTime(),
            source,
          ],
        },
        sourceRunInsertStatement(runId, source, now),
      ],
      "write",
    );
    return created?.rowsAffected === 1 ? runId : null;
  }

  return {
    workflowCursor: workflowCursors.compact,
    resolveWorkflowCursor: workflowCursors.resolve,

    async prepareWakeup(
      now = new Date(),
      sources: readonly DurableIngestionSource[] = DURABLE_INGESTION_SOURCES,
    ): Promise<DurableIngestionWakeupResult> {
      const scheduleKey = IngestionDay.key(now);
      // Free each slot a queued snapshot no longer deserves before reading
      // active runs, so its source is due today (see CommitLease).
      await batchClient.batch(
        [
          ...CommitLease.expireStatements(now),
          ...CommitLease.supersedeStatements(now),
        ],
        "write",
      );
      await database
        .update(ingestionRun)
        .set({ activeSlot: null })
        .where(
          and(
            eq(ingestionRun.activeSlot, 1),
            sql`${ingestionRun.status} != 'running'`,
          ),
        );
      const activeRuns = await database
        .select({ id: ingestionRun.id, source: ingestionRun.source })
        .from(ingestionRun)
        .where(eq(ingestionRun.activeSlot, 1));
      const runs: DurableIngestionWakeupRun[] = activeRuns.map((run) => ({
        action: "resume",
        runId: run.id,
      }));
      // A run across every source (a local `runIngestion`) owns the inventory
      // until it finishes; scheduled runs each cover one source.
      if (activeRuns.some((run) => run.source === "all")) {
        return { status: "active", runs, retryAt: null };
      }

      const sourceDays = await loadIngestionSourceDays(database, scheduleKey);
      // A failed run can cross the day boundary. Its cooldown follows release,
      // even when today's attempt count is still zero. A snapshot released
      // unpublished from the queue (expired or superseded, see CommitLease)
      // was a complete crawl, not a failure, so its source re-crawls without
      // a cooldown.
      const recentFailures = await database
        .select({
          source: ingestionSourceRun.source,
          completedAt: sql<number>`max(${ingestionRun.completedAt})`,
        })
        .from(ingestionSourceRun)
        .innerJoin(ingestionRun, eq(ingestionRun.id, ingestionSourceRun.runId))
        .where(
          and(
            sql`${ingestionRun.completedAt} > ${now.getTime() - IngestionSchedule.retryDelayMs}`,
            sql`not ${SourcePublication.acceptedSql}`,
            sql`${ingestionSourceRun.acceptanceStatus} not in ('expired', 'superseded')`,
          ),
        )
        .groupBy(ingestionSourceRun.source);
      const activeSources = new Set(activeRuns.map((run) => run.source));
      for (const failure of recentFailures) {
        const day = sourceDays.find((day) => day.source === failure.source);
        if (day)
          day.lastCompletedAt = Math.max(
            day.lastCompletedAt ?? 0,
            failure.completedAt,
          );
        else
          sourceDays.push({
            source: failure.source,
            published: false,
            validationRejected: false,
            attempts: 0,
            lastStartedAt: null,
            lastCompletedAt: failure.completedAt,
          });
      }
      const due = IngestionSchedule.dueSources({
        days: sourceDays,
        enabledSources: sources,
        now,
      }).filter((source) => !activeSources.has(source));

      for (const source of due) {
        const runId = await startSourceRun(source, scheduleKey, now);
        // A concurrent wakeup that won the race resumes that source's run.
        if (runId !== null) runs.push({ action: "start", runId });
      }
      if (runs.length > 0) {
        // Active runs can report nothing for hours while they wait for the
        // commit, so the pass re-plans when the next idle source is due.
        const running = new Set([...activeSources, ...due]);
        const retryAt = IngestionSchedule.nextRetryAt({
          days: sourceDays,
          enabledSources: sources.filter((source) => !running.has(source)),
          now,
        });
        return {
          status: "active",
          runs,
          retryAt: retryAt !== null && retryAt > now.getTime() ? retryAt : null,
        };
      }
      // A source started meanwhile by a concurrent wakeup is due for a check
      // shortly; a waiting retry is due when its delay ends.
      const waiting = {
        status: "waiting",
        retryAt:
          IngestionSchedule.nextRetryAt({
            days: sourceDays,
            enabledSources: sources,
            now,
          }) ?? now.getTime() + CONCURRENT_WAKEUP_RECHECK_MS,
      } as const;
      if (
        !IngestionSchedule.passComplete({
          days: sourceDays,
          enabledSources: sources,
        })
      )
        return waiting;
      // A concurrent wakeup may have started a final attempt after the active
      // runs were read; the pass is not over while it runs.
      const [startedMeanwhile] = await database
        .select({ id: ingestionRun.id })
        .from(ingestionRun)
        .where(eq(ingestionRun.activeSlot, 1))
        .limit(1);
      return startedMeanwhile ? waiting : { status: "complete" };
    },

    /**
     * Starts one source outside the daily pass, for example after a fix
     * lands on a day whose attempts are used up. It counts as one of the
     * day's attempts. Busy when the source already has an active run.
     */
    async startManualRun(
      source: DurableIngestionSource,
      now = new Date(),
    ): Promise<{ status: "started"; runId: string } | { status: "busy" }> {
      const runId = await startSourceRun(source, IngestionDay.key(now), now);
      return runId === null ? { status: "busy" } : { status: "started", runId };
    },

    /**
     * Claims the shared commit for a staged run. One active run holds it at a
     * time, even across workflow failures, so reconciliation and Algolia
     * publication never interleave between runs.
     *
     * See {@link CommitLease} for the queue order, liveness, spacing and
     * expiry rules, and for how this claim interlocks with the
     * source-priority claim that workflows pinned to older deployments run.
     * Reconciliation preserves native ownership regardless of arrival order.
     * A full rebuild left by a finished (abandoned) run is taken on here, since
     * runs created before it was abandoned did not inherit it.
     *
     * stopped: the run is no longer active, including a run whose staged
     * snapshot expired at this claim.
     */
    async claimCommit(
      runId: string,
      now = new Date(),
    ): Promise<"claimed" | "busy" | "stopped"> {
      const results = await batchClient.batch(
        [
          ...CommitLease.expireStatements(now),
          CommitLease.claimStatement(runId, now),
          CommitLease.waitStatement(runId, now),
        ],
        "write",
      );
      const result = results.at(-2);
      if (!result) {
        throw new Error(
          `Commit claim for ingestion run ${runId} returned no claim result; no claim was recorded. Retry the claim.`,
        );
      }
      if (result.rowsAffected === 1) return "claimed";
      const [run] = await database
        .select({
          status: ingestionRun.status,
          activeSlot: ingestionRun.activeSlot,
        })
        .from(ingestionRun)
        .where(eq(ingestionRun.id, runId))
        .limit(1);
      return run?.status === "running" && run.activeSlot === 1
        ? "busy"
        : "stopped";
    },

    /** Active runs that have not claimed the commit yet. */
    async listCommitWaiters(): Promise<string[]> {
      const rows = await database
        .select({ id: ingestionRun.id })
        .from(ingestionRun)
        .where(
          and(
            eq(ingestionRun.activeSlot, 1),
            isNull(ingestionRun.commitStartedAt),
          ),
        );
      return rows.map((row) => row.id);
    },

    /**
     * The commit holder and its queue, for operators. The oldest waiter's
     * age is the starvation signal: FIFO keeps it under a few holds.
     */
    async getCommitLeaseStatus(now = new Date()): Promise<CommitLeaseStatus> {
      const liveSince = now.getTime() - CommitLease.livenessMs;
      const readyAt = sql<number>`${sql.raw(CommitLease.readySql("ingestion_run"))}`;
      const waiting = and(
        eq(ingestionRun.activeSlot, 1),
        isNull(ingestionRun.commitStartedAt),
        ne(ingestionRun.stage, "sources"),
      );
      const [[holder], [queue], [oldest]] = await Promise.all([
        database
          .select({
            runId: ingestionRun.id,
            source: ingestionRun.source,
            stage: ingestionRun.stage,
            commitStartedAt: ingestionRun.commitStartedAt,
            lastProgressAt: ingestionRun.lastProgressAt,
          })
          .from(ingestionRun)
          .where(
            and(
              eq(ingestionRun.activeSlot, 1),
              sql`${ingestionRun.commitStartedAt} is not null`,
            ),
          )
          .limit(1),
        database
          .select({
            total: sql<number>`count(*)`,
            live: sql<number>`coalesce(sum(${ingestionRun.lastProgressAt} >= ${liveSince}), 0)`,
          })
          .from(ingestionRun)
          .where(waiting),
        database
          .select({
            runId: ingestionRun.id,
            source: ingestionRun.source,
            readyAt,
            lastProgressAt: ingestionRun.lastProgressAt,
          })
          .from(ingestionRun)
          .where(waiting)
          .orderBy(readyAt, ingestionRun.id)
          .limit(1),
      ]);
      return {
        checkedAt: now.toISOString(),
        holder:
          !holder || holder.commitStartedAt === null
            ? null
            : {
                runId: holder.runId,
                source: holder.source,
                stage: holder.stage,
                commitStartedAt: holder.commitStartedAt.toISOString(),
                heldMs: now.getTime() - holder.commitStartedAt.getTime(),
                lastProgressAgeMs:
                  now.getTime() - holder.lastProgressAt.getTime(),
              },
        waiters: {
          total: queue?.total ?? 0,
          live: queue?.live ?? 0,
          oldest: oldest
            ? {
                runId: oldest.runId,
                source: oldest.source,
                readyAt: new Date(oldest.readyAt).toISOString(),
                waitingMs: now.getTime() - oldest.readyAt,
                live: oldest.lastProgressAt.getTime() >= liveSince,
              }
            : null,
        },
      };
    },

    /** The workflow run attached to each given run that has one. */
    async getAttachedWorkflowRuns(
      runIds: readonly string[],
    ): Promise<Map<string, string>> {
      if (runIds.length === 0) return new Map();
      const rows = await database
        .select({
          id: ingestionRun.id,
          workflowRunId: ingestionRun.workflowRunId,
        })
        .from(ingestionRun)
        .where(inArray(ingestionRun.id, [...runIds]));
      return new Map(
        rows.flatMap((row) =>
          row.workflowRunId === null ? [] : [[row.id, row.workflowRunId]],
        ),
      );
    },

    async attachWorkflowRun(
      runId: string,
      workflowRunId: string,
    ): Promise<void> {
      await database
        .update(ingestionRun)
        .set({ workflowRunId })
        .where(
          and(
            eq(ingestionRun.id, runId),
            eq(ingestionRun.status, "running"),
            eq(ingestionRun.activeSlot, 1),
          ),
        );
    },

    async initialize(
      runId: string,
      resolveSources: () => Promise<
        readonly DurableIngestionSource[]
      > = async () => DURABLE_INGESTION_SOURCES,
    ): Promise<InitializeDurableIngestionResult> {
      // A scheduled run keeps the sources chosen when its wakeup created it.
      const [existingRun] = await database
        .select({ id: ingestionRun.id })
        .from(ingestionRun)
        .where(eq(ingestionRun.id, runId))
        .limit(1);
      if (!existingRun) {
        const sources = await resolveSources();
        const startedAt = new Date();
        await batchClient.batch(
          [
            {
              sql: `
                insert into ingestion_run (
                  id, source, status, stage, active_slot, full_reindex_required,
                  started_at, last_progress_at
                )
                select ?, 'all', 'running', 'sources', 1,
                       case when exists (
                         select 1 from ingestion_run
                         where full_reindex_required = 1
                           and active_slot is null
                       ) or not exists (
                         select 1 from ingestion_run
                         where publication_sequence is not null
                       ) then 1 else 0 end,
                       ?, ?
                where not exists (
                  select 1 from ingestion_run where active_slot = 1
                )
                on conflict(id) do nothing
              `,
              args: [runId, startedAt.getTime(), startedAt.getTime()],
            },
            ...sources.map((source) =>
              sourceRunInsertStatement(runId, source, startedAt),
            ),
          ],
          "write",
        );
      }
      const [run] = await database
        .select({ activeSlot: ingestionRun.activeSlot })
        .from(ingestionRun)
        .where(eq(ingestionRun.id, runId))
        .limit(1);
      if (run?.activeSlot !== 1) {
        // A local run across every source waits for all scheduled runs.
        const [activeRun] = await database
          .select({ id: ingestionRun.id })
          .from(ingestionRun)
          .where(eq(ingestionRun.activeSlot, 1))
          .limit(1);
        return { status: "deduplicated", activeRunId: activeRun?.id ?? null };
      }
      const sourceRows = await database
        .select({ source: ingestionSourceRun.source })
        .from(ingestionSourceRun)
        .where(eq(ingestionSourceRun.runId, runId));
      const runSources = new Set(sourceRows.map((row) => row.source));
      return {
        status: "started",
        runId,
        sources: DURABLE_INGESTION_SOURCES.filter((source) =>
          runSources.has(source),
        ),
      };
    },

    async getCheckpoint<Source extends DurableIngestionSource>(params: {
      runId: string;
      requestedCursor: DurableCursorFor<Source>;
    }): Promise<DurableSourceChunkResult<Source> | null> {
      const source = params.requestedCursor.source;
      const id = sourceRunId(params.runId, source);
      const [row] = await database
        .select()
        .from(ingestionSourceRun)
        .where(eq(ingestionSourceRun.id, id))
        .limit(1);
      if (!row) {
        throw new Error(
          `Source run ${id} does not exist. Initialize the ingestion run first.`,
        );
      }
      const result = toChunkResult(source, row);
      return row.status !== "running" ||
        !durableSourceCursorEquals(result.cursor, params.requestedCursor)
        ? result
        : null;
    },

    async checkpointChunk<Source extends DurableIngestionSource>(params: {
      runId: string;
      requestedCursor: DurableCursorFor<Source>;
      fetched: FetchedDurableSourceChunk<NoInfer<Source>>;
    }): Promise<DurableSourceChunkResult<Source>> {
      const source = params.requestedCursor.source;
      if (params.fetched.cursor.source !== source) {
        throw new Error(
          `Cannot checkpoint ${params.fetched.cursor.source} cursor for ${source} source run`,
        );
      }
      const mismatchedVehicle = params.fetched.vehicles.find(
        (vehicle) => vehicle.source !== source,
      );
      if (mismatchedVehicle) {
        throw new Error(
          `Cannot checkpoint ${mismatchedVehicle.source} vehicle ${mismatchedVehicle.vin} for ${source} source run`,
        );
      }
      // Older durable workflow payloads do not contain yard metadata.
      const yards = (params.fetched.yards ?? []).map((input) => {
        const parsed = Yard.parse(input);
        if (!parsed.success || parsed.data.source !== source) {
          throw new Error(
            `Cannot checkpoint yard ${input.source}:${input.code} for ${source} source run: ${parsed.success ? "source does not match" : parsed.error.message}. No checkpoint data was written.`,
          );
        }
        return parsed.data;
      });
      const observedVins = [
        ...new Set(
          (params.fetched.observedVins ?? []).map((vin) => {
            if (typeof vin !== "string" || !vin.trim()) {
              throw new Error(
                `Cannot checkpoint an empty or invalid observed VIN for ${source}. No checkpoint data was written.`,
              );
            }
            return vin.trim().toUpperCase();
          }),
        ),
      ];
      const yardChecks = params.fetched.yardChecks ?? [];
      const id = sourceRunId(params.runId, source);
      const [current] = await database
        .select()
        .from(ingestionSourceRun)
        .where(eq(ingestionSourceRun.id, id))
        .limit(1);
      if (!current) {
        throw new Error(`Source run ${id} disappeared during checkpointing.`);
      }
      const currentResult = toChunkResult(source, current);
      if (
        current.status !== "running" ||
        !durableSourceCursorEquals(currentResult.cursor, params.requestedCursor)
      ) {
        return currentResult;
      }

      const errors = deduplicateErrors([
        ...parseIngestionErrors(current.errors),
        ...params.fetched.errors,
      ]);
      // A restarted crawl's counts start over with its snapshot.
      const prior = params.fetched.restart
        ? {
            vehiclesProcessed: 0,
            uniqueVehicles: 0,
            duplicateVehicles: 0,
            rejectedVehicles: 0,
          }
        : current;
      const vehiclesProcessed =
        prior.vehiclesProcessed + params.fetched.vehiclesProcessed;
      const uniqueVehicles =
        prior.uniqueVehicles + params.fetched.uniqueVehicles;
      const duplicateVehicles =
        prior.duplicateVehicles + params.fetched.duplicateVehicles;
      const rejectedVehicles =
        prior.rejectedVehicles + params.fetched.rejectedVehicles;
      const pagesProcessed =
        current.pagesProcessed + params.fetched.pagesProcessed;
      const terminal = params.fetched.status !== "paused";
      const status: SourceRunStatus =
        params.fetched.status === "paused"
          ? "running"
          : params.fetched.status === "complete"
            ? "success"
            : statusForFailedSource(vehiclesProcessed);
      const expectedCursor = serializeDurableSourceCursor(
        params.requestedCursor,
      );
      const statements: InStatement[] = [];
      // Stage blobs before the guarded checkpoint that records them. A lost
      // race or a failed write leaves unreferenced blobs, which are deleted
      // below. A restart chunk is always staged: its marker supersedes the
      // earlier chunks, which stay registered for cleanup and Workflow cursor
      // references.
      //
      // Provider checkpoint state (Hollander's ~19 MiB census) is staged in
      // its own blob, never inside the vehicle chunk, so loading a run's
      // inventory does not fetch it once per chunk.
      //
      // Invariant: the stored cursor's statePath names a blob staged for
      // exactly that cursor, under a unique pathname, and the cursor, the
      // chunk and the state commit in one guarded statement. Blobs are never
      // overwritten, so a lost race, a crash or a failed write leaves the
      // previous cursor paired with the previous state. The state it replaces
      // is deleted only after that commit; a Workflow step or cursor
      // reference that still holds the older cursor gets the newer checkpoint
      // from getCheckpoint before any provider work loads state.
      const staged: string[] = [];
      const unstage = async () => {
        if (staged.length === 0) return;
        try {
          // Best effort: a checkpoint never waits on Blob pacing or retries.
          await snapshotStore.delete(staged, { kind: "best-effort" });
        } catch (error) {
          console.error(
            `Could not delete unrecorded snapshot blobs ${staged.join(", ")} of source run ${id}. No checkpoint references them and the previous checkpoint is intact, but snapshot cleanup will not find them; delete them from private Blob storage by hand.`,
            error,
          );
        }
      };
      let statePathname: string | null = null;
      let next: DurableCursorFor<Source>;
      let nextCursor: string;
      try {
        if (
          params.fetched.vehicles.length > 0 ||
          observedVins.length > 0 ||
          yardChecks.length > 0 ||
          params.fetched.restart
        ) {
          staged.push(
            await snapshotStore.put({
              runId: params.runId,
              source,
              chunk: {
                vehicles: params.fetched.vehicles,
                observedVins,
                ...(yardChecks.length > 0 ? { yardChecks } : {}),
                ...(params.fetched.restart ? { restart: true } : {}),
              },
            }),
          );
        }
        if (params.fetched.checkpointState !== undefined) {
          statePathname = await snapshotStore.putCheckpointState({
            runId: params.runId,
            source,
            state: params.fetched.checkpointState,
          });
          staged.push(statePathname);
        }
        // Store provider progress in the same guarded checkpoint as its
        // resume cursor. A cursor that does not parse leaves nothing staged.
        next =
          statePathname === null
            ? params.fetched.cursor
            : parseDurableSourceCursor(
                source,
                JSON.stringify({
                  ...params.fetched.cursor,
                  statePath: statePathname,
                }),
              );
        nextCursor = serializeDurableSourceCursor(next);
      } catch (error) {
        await unstage();
        throw error;
      }
      // The state this checkpoint replaces, once it commits: only a separate
      // state blob this source run registered. A chunk staged before the
      // split embeds its state but is an ordinary chunk that may hold
      // vehicles, and URG may resume from the census of an earlier run, so
      // neither is ever deleted here.
      const supersededState =
        statePathname === null
          ? null
          : supersededStatePath(params.requestedCursor, current.snapshotChunks);
      const deleteSuperseded = async () => {
        if (supersededState === null) return;
        try {
          await snapshotStore.delete([supersededState], {
            kind: "best-effort",
          });
        } catch (error) {
          console.error(
            `Could not delete superseded checkpoint state ${supersededState} of source run ${id}. The new checkpoint is saved and inventory is unaffected, but the blob is no longer registered, so snapshot cleanup will not remove it; delete it from private Blob storage by hand.`,
            error,
          );
        }
      };

      for (
        let start = 0;
        start < yards.length;
        start += SNAPSHOT_WRITE_BATCH_SIZE
      ) {
        statements.push(
          yardUpsertStatement({
            runId: params.runId,
            source,
            expectedCursor,
            yards: yards.slice(start, start + SNAPSHOT_WRITE_BATCH_SIZE),
          }),
        );
      }

      // Unregister the superseded state with the commit that replaces it, so
      // every registered blob exists once it is deleted below.
      const withoutSuperseded =
        supersededState === null
          ? "snapshot_chunks"
          : "coalesce(json_remove(snapshot_chunks, (select fullkey from json_each(snapshot_chunks) where value = ? limit 1)), snapshot_chunks)";
      const registeredChunks =
        staged.length === 0
          ? withoutSuperseded
          : `json_insert(${withoutSuperseded}${", '$[#]', ?".repeat(staged.length)})`;
      const checkpointStatementIndex = statements.length;
      statements.push({
        sql: `
          update ingestion_source_run
          set status = ?,
              next_cursor = ?,
              pages_processed = ?,
              vehicles_processed = ?,
              unique_vehicles = ?,
              duplicate_vehicles = ?,
              rejected_vehicles = ?,
              errors = ?,
              validation_errors = ?,
              snapshot_chunks = ${registeredChunks},
              completed_at = ?
          where id = ?
            and run_id = ?
            and source = ?
            and status = 'running'
            and next_cursor = ?
            and exists (
              select 1 from ingestion_run
              where id = ? and status = 'running'
            )
        `,
        args: [
          status,
          nextCursor,
          pagesProcessed,
          vehiclesProcessed,
          uniqueVehicles,
          duplicateVehicles,
          rejectedVehicles,
          errors.length > 0 ? JSON.stringify(errors) : null,
          params.fetched.failureKind === "deterministic"
            ? JSON.stringify(errors)
            : null,
          ...(supersededState === null ? [] : [supersededState]),
          ...staged,
          terminal ? Date.now() : null,
          id,
          params.runId,
          source,
          expectedCursor,
          params.runId,
        ],
      });
      statements.push({
        sql: `
          update ingestion_run
          set last_progress_at = ?
          where id = ?
            and status = 'running'
            and exists (
              select 1 from ingestion_source_run
              where id = ? and next_cursor = ?
            )
        `,
        args: [Date.now(), params.runId, id, nextCursor],
      });

      const results = await batchClient
        .batch(statements, "write")
        .catch(async (error: unknown) => {
          // A lost response can hide a commit that landed, and deleting its
          // blobs would leave the committed cursor without its state. Delete
          // them only once the row shows they are not registered.
          const registration = await stagedRegistration(id, staged);
          if (registration === "absent") await unstage();
          else if (registration === "registered") await deleteSuperseded();
          else
            console.error(
              `Could not tell whether source run ${id} committed its checkpoint, so its staged blobs ${staged.join(", ")} are kept. A retry resumes from whichever checkpoint is saved; if nothing references them, snapshot cleanup will not find them.`,
            );
          throw error;
        });
      const checkpointResult = results[checkpointStatementIndex];
      if (!checkpointResult) {
        throw new Error(`Source run ${id} checkpoint returned no result.`);
      }
      if (checkpointResult.rowsAffected === 1) {
        // The new state is committed, so nothing resumes from the superseded
        // one: a replay of the old cursor gets this checkpoint back from
        // getCheckpoint before it fetches.
        await deleteSuperseded();
        return {
          cursor: next,
          status: params.fetched.status,
          count: vehiclesProcessed,
          uniqueVehicles,
          duplicateVehicles,
          rejectedVehicles,
          pagesProcessed,
          errors,
        };
      }
      if (checkpointResult.rowsAffected !== 0) {
        throw new Error(
          `Source run ${id} checkpoint affected ${checkpointResult.rowsAffected} rows; expected 0 or 1.`,
        );
      }
      await unstage();

      const [latest] = await database
        .select()
        .from(ingestionSourceRun)
        .where(eq(ingestionSourceRun.id, id))
        .limit(1);
      if (!latest) {
        throw new Error(`Source run ${id} disappeared after checkpointing.`);
      }
      return toChunkResult(source, latest);
    },

    async markSourceFailed<Source extends DurableIngestionSource>(params: {
      runId: string;
      source: Source;
      message: string;
      validationRejected?: boolean;
    }): Promise<DurableSourceChunkResult<Source>> {
      const id = sourceRunId(params.runId, params.source);
      const [current] = await database
        .select()
        .from(ingestionSourceRun)
        .where(eq(ingestionSourceRun.id, id))
        .limit(1);
      if (!current) throw new Error(`Cannot fail missing source run ${id}.`);
      if (current.status !== "running") {
        return toChunkResult(params.source, current);
      }

      const errors = deduplicateErrors([
        ...parseIngestionErrors(current.errors),
        params.message,
      ]);
      const status: SourceRunStatus =
        current.vehiclesProcessed > 0 ? "partial" : "error";
      const updated = await database
        .update(ingestionSourceRun)
        .set({
          status,
          errors: JSON.stringify(errors),
          validationErrors: params.validationRejected
            ? JSON.stringify(errors)
            : null,
          completedAt: new Date(),
        })
        .where(
          and(
            eq(ingestionSourceRun.id, id),
            eq(ingestionSourceRun.status, "running"),
            sql`exists (
              select 1 from ingestion_run
              where id = ${params.runId}
                and status = 'running'
                and active_slot = 1
            )`,
          ),
        );
      if (updated.rowsAffected === 1) {
        return {
          ...toChunkResult(params.source, current),
          status: "failed",
          errors,
        };
      }
      const [latest] = await database
        .select()
        .from(ingestionSourceRun)
        .where(eq(ingestionSourceRun.id, id))
        .limit(1);
      if (!latest) throw new Error(`Source run ${id} disappeared.`);
      return toChunkResult(params.source, latest);
    },

    /** Each source's latest attempt and accepted publication in the freshness lookback. */
    getSourceFreshness(now: Date): Promise<IngestionSourceFreshness[]> {
      return loadSourceFreshness(database, now);
    },

    async getRun(runId: string) {
      const [run] = await database
        .select()
        .from(ingestionRun)
        .where(eq(ingestionRun.id, runId))
        .limit(1);
      if (!run) throw new Error(`Ingestion run ${runId} does not exist.`);
      return run;
    },

    getSourceRuns(runId: string) {
      return database
        .select()
        .from(ingestionSourceRun)
        .where(eq(ingestionSourceRun.runId, runId));
    },

    async markRunFailed(runId: string, message: string): Promise<void> {
      const [run] = await database
        .select({
          executionErrors: ingestionRun.executionErrors,
          executionFailures: ingestionRun.executionFailures,
          stage: ingestionRun.stage,
        })
        .from(ingestionRun)
        .where(eq(ingestionRun.id, runId))
        .limit(1);
      if (!run)
        throw new Error(`Cannot record failure for missing run ${runId}.`);
      const errors = deduplicateErrors([
        ...parseIngestionErrors(run.executionErrors),
        message,
      ]);
      const failures = run.executionFailures + 1;
      await database
        .update(ingestionRun)
        .set({
          executionErrors: JSON.stringify(errors),
          executionFailures: failures,
          stage:
            run.stage === "full_reindex_publish"
              ? "full_reindex_publish_failed"
              : run.stage,
        })
        .where(
          and(
            eq(ingestionRun.id, runId),
            eq(ingestionRun.status, "running"),
            eq(ingestionRun.activeSlot, 1),
            eq(ingestionRun.stage, run.stage),
          ),
        );
      // A run that keeps failing would hold its source, and possibly the
      // shared commit, forever. Abandon it as an operator would: its source
      // retries within the daily schedule, and a started reconciliation makes
      // the next run rebuild search. An unconfirmed Algolia move and alert
      // matching stay resumable.
      if (
        failures >= MAX_EXECUTION_FAILURES &&
        run.stage !== "full_reindex_move_pending" &&
        // A run the previous release left matching alerts: abandoning it
        // would cancel intents whose searches already advanced their
        // checkpoints, losing those alerts.
        run.stage !== "match_alerts"
      ) {
        await this.abandon(runId, true);
      }
    },

    async abandon(
      runId: string,
      force: boolean,
    ): Promise<RunAbandonmentResult> {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const [run] = await database
          .select({
            stage: ingestionRun.stage,
            status: ingestionRun.status,
            fullReindexRequired: ingestionRun.fullReindexRequired,
            workflowRunId: ingestionRun.workflowRunId,
          })
          .from(ingestionRun)
          .where(eq(ingestionRun.id, runId))
          .limit(1);
        if (!run) throw new Error(`Cannot abandon missing run ${runId}.`);
        if (run.status !== "running") {
          return { status: "already_ended", runStatus: run.status };
        }
        const check = RunAbandonment.check({ runId, stage: run.stage, force });
        if (check.status !== "allowed") throw new Error(check.message);
        const reconciliationStarted = check.fullRebuild;
        const completedAt = Date.now();
        const results = await batchClient.batch(
          [
            {
              sql: `
                update ingestion_run
                set status = 'abandoned', active_slot = null,
                    full_reindex_required = ?, completed_at = ?, released_at = ?
                where id = ? and status = 'running' and active_slot = 1
                  and stage = ?
              `,
              args: [
                Number(reconciliationStarted || run.fullReindexRequired),
                completedAt,
                completedAt,
                runId,
                run.stage,
              ],
            },
            {
              sql: `
                update ingestion_source_run
                set status = 'error', completed_at = ?
                where run_id = ? and status = 'running'
                  and exists (
                    select 1 from ingestion_run
                    where id = ? and status = 'abandoned'
                  )
              `,
              args: [completedAt, runId, runId],
            },
            {
              sql: `
                update search_notification_intent
                set status = 'cancelled', cancelled_at = ?, claim_token = null,
                    last_error = 'owning_ingestion_run_abandoned'
                where run_id = ?
                  and status in ('pending', 'retry', 'sending')
                  and exists (
                    select 1 from ingestion_run
                    where id = ? and status = 'abandoned'
                  )
              `,
              args: [completedAt, runId, runId],
            },
          ],
          "write",
        );
        const abandoned = results[0];
        if (!abandoned) {
          throw new Error(`Abandoning ingestion run ${runId} had no result.`);
        }
        if (abandoned.rowsAffected === 1) {
          return { status: "abandoned", workflowRunId: run.workflowRunId };
        }
      }
      throw new Error(
        `Ingestion run ${runId} kept advancing while abandonment was attempted. Retry the request.`,
      );
    },

    /**
     * One batch of a released run's cleanup. Snapshot deletes stop at the
     * cleanup budget and report not done, so the next batch, in a fresh
     * step, resumes from the chunks still registered.
     */
    async cleanupBatch(runId: string, now: () => number = Date.now) {
      const [run] = await database
        .select({ activeSlot: ingestionRun.activeSlot })
        .from(ingestionRun)
        .where(eq(ingestionRun.id, runId))
        .limit(1);
      const snapshots =
        run && run.activeSlot === null
          ? await IngestionSnapshotCleanup.deleteRunSnapshots(
              database,
              snapshotStore,
              await database
                .select({
                  id: ingestionSourceRun.id,
                  snapshotChunks: ingestionSourceRun.snapshotChunks,
                })
                .from(ingestionSourceRun)
                .where(
                  and(
                    eq(ingestionSourceRun.runId, runId),
                    ne(ingestionSourceRun.snapshotChunks, "[]"),
                  ),
                )
                .orderBy(asc(ingestionSourceRun.id)),
              IngestionSnapshotCleanup.budget(now),
            )
          : { deleted: 0, status: "complete" as const };
      // A stop with no progress would make the next batch stop the same way,
      // and drainDurableCleanup would loop without end.
      if (snapshots.status === "stopped" && snapshots.deleted === 0)
        throw new Error(
          `Cleanup of ingestion run ${runId} deleted no snapshot blobs within its ${SNAPSHOT_CLEANUP_BUDGET_MS / 1_000} s budget: Vercel Blob kept rate limiting or did not answer. Its chunks are still registered, so the daily stale-snapshot cleanup deletes them later; published inventory is unaffected.`,
        );
      const results = await batchClient.batch(
        [
          {
            sql: `
              delete from vehicle_change_v2
              where id in (
                select id from vehicle_change_v2
                where processed_at is not null
                order by processed_at, id
                limit ?
              )
            `,
            args: [CLEANUP_BATCH_SIZE],
          },
        ],
        "write",
      );
      const deleted = results.reduce(
        (total, result) => total + result.rowsAffected,
        snapshots.deleted,
      );
      return {
        deleted,
        done:
          snapshots.status === "complete" &&
          results.every((result) => result.rowsAffected < CLEANUP_BATCH_SIZE),
      };
    },

    /** One batch of chunks left by runs no longer active. */
    cleanupStaleSnapshots(): Promise<StaleSnapshotCleanup> {
      return IngestionSnapshotCleanup.staleBatch(
        database,
        snapshotStore,
        IngestionSnapshotCleanup.budget(),
      );
    },
  };
}

export type DurableIngestionRepository = ReturnType<
  typeof createDurableIngestionRepository
>;
