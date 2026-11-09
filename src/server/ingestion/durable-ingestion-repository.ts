import { IngestionDay } from "./ingestion-day";
import type { Client, InStatement } from "@libsql/client";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
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
import type { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import { IngestionSchedule } from "./ingestion-schedule";
import {
  reconciliationSourcePriority,
  reconciliationSourcePrioritySql,
} from "./reconciliation-policy";
import type { IngestionSourceFreshness } from "./durable-health";

const SNAPSHOT_WRITE_BATCH_SIZE = 500;
const CLEANUP_BATCH_SIZE = 5_000;
const STALE_SNAPSHOT_RUN_BATCH_SIZE = 50;
const MAX_EXECUTION_FAILURES = 5;
const CONCURRENT_WAKEUP_RECHECK_MS = 5 * 60 * 1000;
const TERMINAL_INTENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

type SourceRunStatus = "running" | "success" | "partial" | "error";
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

export function parseSnapshotChunks(json: string): string[] {
  const parsed: unknown = JSON.parse(json);
  if (
    !Array.isArray(parsed) ||
    !parsed.every((pathname) => typeof pathname === "string")
  ) {
    throw new Error(
      `ingestion_source_run.snapshot_chunks must be a JSON array of Blob pathnames; got ${json.slice(0, 200)}.`,
    );
  }
  return parsed;
}

export function createDurableIngestionRepository(
  database: LibSQLDatabase,
  batchClient: LibSqlBatchClient,
  snapshotStore: IngestionSnapshotStore,
) {
  /** Deletes released runs' staged chunks and returns how many it deleted. */
  async function deleteRunSnapshots(
    rows: readonly { id: string; snapshotChunks: string }[],
  ): Promise<number> {
    let deleted = 0;
    for (const row of rows) {
      const pathnames = parseSnapshotChunks(row.snapshotChunks);
      await snapshotStore.delete(pathnames);
      await database
        .update(ingestionSourceRun)
        .set({ snapshotChunks: "[]" })
        .where(eq(ingestionSourceRun.id, row.id));
      deleted += pathnames.length;
    }
    return deleted;
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
    async prepareWakeup(
      now = new Date(),
      sources: readonly DurableIngestionSource[] = DURABLE_INGESTION_SOURCES,
    ): Promise<DurableIngestionWakeupResult> {
      const scheduleKey = IngestionDay.key(now);
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
        return { status: "active", runs };
      }

      const days = await database
        .select({
          source: ingestionSourceRun.source,
          published: sql<number>`max(
            ${ingestionSourceRun.acceptanceStatus} = 'accepted'
            and ${ingestionRun.searchPublishedAt} is not null
          )`,
          attempts: sql<number>`count(*)`,
          lastStartedAt: sql<
            number | null
          >`max(${ingestionSourceRun.startedAt})`,
        })
        .from(ingestionSourceRun)
        .innerJoin(ingestionRun, eq(ingestionRun.id, ingestionSourceRun.runId))
        .where(eq(ingestionRun.scheduleKey, scheduleKey))
        .groupBy(ingestionSourceRun.source);
      const activeSources = new Set(activeRuns.map((run) => run.source));
      const sourceDays = days.map((day) => ({
        ...day,
        published: day.published === 1,
      }));
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
      if (runs.length > 0) return { status: "active", runs };
      // A source started meanwhile by a concurrent wakeup is due for a check
      // shortly; a waiting retry is due when its delay ends.
      const waiting = {
        status: "waiting",
        retryAt:
          IngestionSchedule.nextRetryAt({
            days: sourceDays,
            enabledSources: sources,
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
     * time, even across workflow failures, so reconciliation, Algolia
     * publication, and alert matching never interleave between runs.
     *
     * Active runs claim in source-priority order: a VIN two sources list
     * settles on its higher-priority owner before alerts first see it, so a
     * search filtered to that owner is not skipped. The claim time, which
     * stamps the run's newly seen vehicles, follows every earlier alert check.
     * A full rebuild left by a finished (abandoned) run is taken on here, since
     * runs created before it was abandoned did not inherit it.
     */
    async claimCommit(
      runId: string,
      now = new Date(),
    ): Promise<"claimed" | "busy" | "stopped"> {
      const [current] = await database
        .select({ source: ingestionRun.source })
        .from(ingestionRun)
        .where(eq(ingestionRun.id, runId))
        .limit(1);
      if (!current) return "stopped";
      const [result] = await batchClient.batch(
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
                -- A run resuming its own commit skips the first-claim waits.
                and (commit_started_at is not null or (
                  not exists (
                    select 1 from ingestion_run other
                    where other.id <> ? and other.active_slot = 1
                      and (${reconciliationSourcePrioritySql("other")}) < ?
                  )
                  -- Algolia compares whole seconds, so stamp a full second
                  -- after the newest alert check.
                  and ? >= (
                    select coalesce(max(last_checked_at), 0) + 1000
                    from saved_search
                  )
                ))
            `,
            args: [
              now.getTime(),
              now.getTime(),
              runId,
              runId,
              runId,
              reconciliationSourcePriority(current.source),
              now.getTime(),
            ],
          },
        ],
        "write",
      );
      if (result?.rowsAffected === 1) return "claimed";
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
      const vehiclesProcessed =
        current.vehiclesProcessed + params.fetched.vehiclesProcessed;
      const uniqueVehicles =
        current.uniqueVehicles + params.fetched.uniqueVehicles;
      const duplicateVehicles =
        current.duplicateVehicles + params.fetched.duplicateVehicles;
      const rejectedVehicles =
        current.rejectedVehicles + params.fetched.rejectedVehicles;
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
      const nextCursor = serializeDurableSourceCursor(params.fetched.cursor);
      const statements: InStatement[] = [];
      // Stage the chunk before the guarded checkpoint that records it. A lost
      // race leaves an unreferenced blob, which is deleted below.
      const snapshotPathname =
        params.fetched.vehicles.length > 0 || observedVins.length > 0
          ? await snapshotStore.put({
              runId: params.runId,
              source,
              chunk: { vehicles: params.fetched.vehicles, observedVins },
            })
          : null;

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
              snapshot_chunks = case
                when ? is null then snapshot_chunks
                else json_insert(snapshot_chunks, '$[#]', ?)
              end,
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
          snapshotPathname,
          snapshotPathname,
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
          if (snapshotPathname !== null)
            await snapshotStore.delete([snapshotPathname]);
          throw error;
        });
      const checkpointResult = results[checkpointStatementIndex];
      if (!checkpointResult) {
        throw new Error(`Source run ${id} checkpoint returned no result.`);
      }
      if (checkpointResult.rowsAffected === 1) {
        return {
          cursor: params.fetched.cursor,
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
      if (snapshotPathname !== null)
        await snapshotStore.delete([snapshotPathname]);

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

    /** Each source's latest attempt and accepted publication in the last 3 days. */
    async getSourceFreshness(now: Date): Promise<IngestionSourceFreshness[]> {
      const rows = await database
        .select({
          source: ingestionSourceRun.source,
          lastAttemptAt: sql<number>`max(${ingestionSourceRun.startedAt})`,
          lastPublishedAt: sql<number | null>`max(case
            when ${ingestionSourceRun.acceptanceStatus} = 'accepted'
            then ${ingestionRun.searchPublishedAt}
          end)`,
        })
        .from(ingestionSourceRun)
        .innerJoin(ingestionRun, eq(ingestionRun.id, ingestionSourceRun.runId))
        .where(
          sql`${ingestionSourceRun.startedAt} > ${now.getTime() - 3 * 24 * 60 * 60 * 1000}`,
        )
        .groupBy(ingestionSourceRun.source);
      return rows;
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
        // Abandoning would cancel intents whose searches already advanced
        // their checkpoints, losing those alerts.
        run.stage !== "match_alerts"
      ) {
        await this.abandon(runId, true);
      }
    },

    async abandon(runId: string, force: boolean): Promise<string | null> {
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
        if (run.status !== "running") return null;
        if (run.stage === "full_reindex_move_pending") {
          throw new Error(
            `Run ${runId} has an unconfirmed Algolia index move and cannot be abandoned. Retry after Algolia publication is confirmed.`,
          );
        }
        const reconciliationStarted = run.stage !== "sources";
        if (reconciliationStarted && !force) {
          throw new Error(
            `Run ${runId} entered ${run.stage}; force is required and will mandate a full Algolia rebuild.`,
          );
        }
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
        if (abandoned.rowsAffected === 1) return run.workflowRunId;
      }
      throw new Error(
        `Ingestion run ${runId} kept advancing while abandonment was attempted. Retry the request.`,
      );
    },

    async cleanupBatch(runId: string, now = new Date()) {
      const [run] = await database
        .select({ activeSlot: ingestionRun.activeSlot })
        .from(ingestionRun)
        .where(eq(ingestionRun.id, runId))
        .limit(1);
      const snapshotsDeleted =
        run && run.activeSlot === null
          ? await deleteRunSnapshots(
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
                ),
            )
          : 0;
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
          {
            sql: `
              delete from search_notification_intent
              where id in (
                select id from search_notification_intent
                where status in ('delivered', 'cancelled')
                  and created_at < ?
                order by created_at, id
                limit ?
              )
            `,
            args: [
              now.getTime() - TERMINAL_INTENT_RETENTION_MS,
              CLEANUP_BATCH_SIZE,
            ],
          },
        ],
        "write",
      );
      const deleted = results.reduce(
        (total, result) => total + result.rowsAffected,
        snapshotsDeleted,
      );
      return {
        deleted,
        done: results.every(
          (result) => result.rowsAffected < CLEANUP_BATCH_SIZE,
        ),
      };
    },

    async cleanupStaleSnapshots(): Promise<void> {
      await deleteRunSnapshots(
        await database
          .select({
            id: ingestionSourceRun.id,
            snapshotChunks: ingestionSourceRun.snapshotChunks,
          })
          .from(ingestionSourceRun)
          .innerJoin(
            ingestionRun,
            eq(ingestionRun.id, ingestionSourceRun.runId),
          )
          .where(
            and(
              isNull(ingestionRun.activeSlot),
              ne(ingestionSourceRun.snapshotChunks, "[]"),
            ),
          )
          .limit(STALE_SNAPSHOT_RUN_BATCH_SIZE),
      );
      // Drain rows staged before snapshots moved to Blob storage.
      await database.run(sql`
        delete from vehicle_observation where rowid in (
          select observation.rowid from vehicle_observation observation
          join ingestion_run run on run.id = observation.run_id
          where run.active_slot is null
          limit ${CLEANUP_BATCH_SIZE}
        )
      `);
      await database.run(sql`
        delete from vehicle_snapshot
        where rowid in (
          select snapshot.rowid
          from vehicle_snapshot snapshot
          join ingestion_run run on run.id = snapshot.run_id
          where run.active_slot is null
          limit ${CLEANUP_BATCH_SIZE}
        )
      `);
    },
  };
}

export type DurableIngestionRepository = ReturnType<
  typeof createDurableIngestionRepository
>;
