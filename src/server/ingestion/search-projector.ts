import { sql } from "drizzle-orm";
import type { InStatement } from "@libsql/client";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { Effect, Either } from "effect";
import type { AlgoliaErrorTag } from "~/lib/algolia-failure-tag";
import type { AlgoliaError } from "./algolia-error";
import {
  SearchIndexDrift,
  type SearchIndexDriftResult,
} from "./search-index-drift";
import {
  SearchIndexGenerations,
  type ActiveSearchIndexGeneration,
  type LiveSearchIndexGeneration,
  type SearchIndexGenerationReason,
} from "./search-index-generation";
import {
  SearchIndexRebuild,
  type SearchIndexRebuildResult,
} from "./search-index-rebuild";
import { SearchOutbox } from "./search-outbox";
import {
  collapse,
  deadLetterStatement,
  readVehicles,
  saveIsolating,
  truncate,
  type DeadLetter,
  type SearchProjectorContext,
} from "./search-projection-batch";
import { SearchProjectorCheckpoint } from "./search-projector-checkpoint";
import {
  SearchRebuildWait,
  type SearchRebuildWaitReason,
} from "./search-rebuild-wait";

export type { SearchProjectorContext } from "./search-projection-batch";

/** Changes read per batch; a step runs several batches. */
const CHANGE_BATCH_SIZE = 5_000;
// Leave room in a workflow step for the batch that is already running.
const STEP_BUDGET_MS = 180_000;

/**
 * One projector step's outcome. Every variant is plain data (a workflow step
 * result). Nothing here ever writes `ingestion_run`.
 *
 * - inline_writer_active: a run still publishes search inline; the projector
 *   writes nothing until it releases (single-writer invariant).
 * - environment_mismatch: the database's search generations belong to
 *   another deployment's index; this deployment refuses to write.
 * - rebuild_requested: no live generation describes the index yet (or the
 *   daily drift check found drift); a rebuild was requested.
 * - rebuild_*, record_cap, move_unconfirmed: a rebuild step, see
 *   SearchIndexRebuildResult.
 * - drift_checked: the daily drift check ran, see SearchIndexDriftResult.
 * - rebuild_waiting: a requested rebuild cannot start yet (record cap or
 *   no live index); see SearchRebuildWait.
 * - circuit_open: a recent failure blocks writes until `retryAt`.
 * - current: nothing between the cursor and the horizon.
 * - projected: batches written and the cursor advanced; `caughtUp` when the
 *   step reached the horizon it last read.
 * - stopped: another projector advanced the cursor first.
 * - failed: the backend failed; the cursor stays and the circuit backs off.
 */
export type SearchProjectorStepResult =
  | { status: "inline_writer_active"; runIds: string[] }
  | { status: "environment_mismatch"; generationEnvironment: string }
  | {
      status: "rebuild_requested";
      generationId: string;
      reason: SearchIndexGenerationReason;
    }
  | Exclude<SearchIndexRebuildResult, { status: "stopped" }>
  | SearchIndexDriftResult
  | {
      status: "rebuild_waiting";
      generationId: string;
      reason: SearchRebuildWaitReason;
      /** ISO time. */
      retryAt: string;
    }
  | {
      status: "circuit_open";
      tag: AlgoliaErrorTag;
      failureCount: number;
      /** ISO time. */
      retryAt: string;
    }
  | { status: "current"; projectedThrough: number; horizon: number }
  | {
      status: "projected";
      from: number;
      projectedThrough: number;
      horizon: number;
      changes: number;
      upserted: number;
      deleted: number;
      deadLettered: number;
      caughtUp: boolean;
    }
  | { status: "stopped" }
  | {
      status: "failed";
      tag: AlgoliaErrorTag;
      message: string;
      failureCount: number;
      /** ISO time. */
      retryAt: string;
      /** Whether this failure opened the circuit, rather than kept it open. */
      opened: boolean;
      /** Changes projected by earlier batches of the step. */
      changes: number;
    };

/** Inline search stages; a run in one writes search itself. */
const INLINE_WRITER_STAGES = [
  "project_changes",
  "full_reindex_prepare",
  "full_reindex_load",
  "full_reindex_publish",
  "full_reindex_move_pending",
  "full_reindex_publish_failed",
  "match_alerts",
];

type BatchOutcome =
  | { status: "empty" }
  | { status: "stopped" }
  | {
      status: "projected";
      to: number;
      changes: number;
      upserted: number;
      deleted: number;
      deadLettered: number;
    };

/** Writes one batch of changes to search, then advances the cursor. */
function projectBatch(
  context: SearchProjectorContext,
  from: number,
  horizon: number,
): Effect.Effect<BatchOutcome, AlgoliaError> {
  return Effect.gen(function* () {
    const changes = yield* Effect.promise(() =>
      SearchOutbox.read(context.database, {
        after: from,
        through: horizon,
        limit: CHANGE_BATCH_SIZE,
      }),
    );
    const last = changes.at(-1);
    if (last === undefined) {
      if (from >= horizon) return { status: "empty" } as const;
      // The changes up to the horizon were deleted (projected inline, or
      // pruned with their run): nothing is left to write there.
      const [skipped] = yield* Effect.promise(() =>
        context.client.batch(
          [
            SearchProjectorCheckpoint.advanceStatement({
              from,
              to: horizon,
              now: context.now(),
            }),
            SearchProjectorCheckpoint.clearSettledRebuildsStatement(horizon),
          ],
          "write",
        ),
      );
      if (skipped?.rowsAffected !== 1) return { status: "stopped" } as const;
      return {
        status: "projected",
        to: horizon,
        changes: 0,
        upserted: 0,
        deleted: 0,
        deadLettered: 0,
      } as const;
    }
    const latest = collapse(changes);
    const changeIdByVin = new Map(
      latest.map((change) => [change.vin, change.id]),
    );
    const rereadVins = latest
      .filter((change) => change.changeType !== "delete")
      .map((change) => change.vin);
    const rows = yield* Effect.promise(() =>
      readVehicles(context.database, rereadVins),
    );
    // A change whose vehicle is gone (deleted by a later batch, say) is a
    // delete: the index must not keep a vehicle Turso no longer has.
    const deleteVins = latest
      .filter(
        (change) => change.changeType === "delete" || !rows.has(change.vin),
      )
      .map((change) => change.vin);
    // A projection failure (Turso, or a row the code cannot map) fails the
    // step without moving the cursor: it is retried, and an operator sees it.
    const records = yield* Effect.promise(() =>
      context.project([...rows.values()]),
    );
    const saved = yield* saveIsolating(
      context.writer,
      context.indexName,
      records,
    );
    const deadLetters: DeadLetter[] = saved.rejected.map(
      ({ record, error }) => ({
        changeId: changeIdByVin.get(record.objectID) ?? 0,
        vin: record.objectID,
        tag: error._tag,
        detail: truncate(error.message),
      }),
    );
    const deleteTask = yield* context.writer.deleteObjects(
      context.indexName,
      deleteVins,
    );
    // Tasks run in order per index, so the last one covers the batch.
    const finalTask = deleteTask ?? saved.taskIds.at(-1) ?? null;
    if (finalTask !== null) {
      yield* context.writer.waitForTask(context.indexName, finalTask);
    }
    const now = context.now();
    const statements: InStatement[] = [
      SearchProjectorCheckpoint.advanceStatement({ from, to: last.id, now }),
      SearchProjectorCheckpoint.clearSettledRebuildsStatement(last.id),
      ...deadLetters.map((letter) =>
        deadLetterStatement({
          letter,
          environment: context.environment,
          indexName: context.indexName,
          now,
          guard: {
            sql: `exists (
              select 1 from ingestion_projector_checkpoint
              where name = ? and last_processed_change_id = ?
                and last_success_at = ?
            )`,
            args: [SearchProjectorCheckpoint.name, last.id, now.getTime()],
          },
        }),
      ),
    ];
    const results = yield* Effect.promise(() =>
      context.client.batch(statements, "write"),
    );
    if (results[0]?.rowsAffected !== 1) return { status: "stopped" } as const;
    return {
      status: "projected",
      to: last.id,
      changes: changes.length,
      upserted: records.length - saved.rejected.length,
      deleted: deleteVins.length,
      deadLettered: deadLetters.length,
    } as const;
  });
}

/** Runs still publishing search inline, which the projector waits for. */
export async function inlineWriterRuns(
  database: LibSQLDatabase,
): Promise<string[]> {
  const rows = await database.run(
    `select id from ingestion_run
     where active_slot = 1
       and stage in (${INLINE_WRITER_STAGES.map((stage) => `'${stage}'`).join(", ")})
     order by id`,
  );
  return rows.rows.map((row) => String(row.id));
}

/** Why the projector may not write now, before it reads any change. */
type Gate =
  | { status: "inline_writer_active"; runIds: string[] }
  | { status: "environment_mismatch"; generationEnvironment: string }
  | {
      status: "circuit_open";
      tag: AlgoliaErrorTag;
      failureCount: number;
      /** ISO time. */
      retryAt: string;
    }
  | {
      status: "open";
      projectedThrough: number;
      probe: boolean;
      live: LiveSearchIndexGeneration | null;
      active: ActiveSearchIndexGeneration | null;
    };

async function gate(
  database: LibSQLDatabase,
  environment: string,
  now: Date,
): Promise<Gate> {
  const runIds = await inlineWriterRuns(database);
  if (runIds.length > 0) return { status: "inline_writer_active", runIds };
  const generations = await SearchIndexGenerations.forEnvironment(
    database,
    environment,
  );
  if (generations.status === "foreign") {
    return {
      status: "environment_mismatch",
      generationEnvironment: generations.environment,
    };
  }
  const checkpoint = await SearchProjectorCheckpoint.read(database);
  const circuit = SearchProjectorCheckpoint.circuit(checkpoint, now);
  if (circuit.state === "open") {
    return {
      status: "circuit_open",
      tag: circuit.tag,
      failureCount: circuit.failureCount,
      retryAt: circuit.retryAt.toISOString(),
    };
  }
  return {
    status: "open",
    projectedThrough: checkpoint.projectedThrough,
    probe: circuit.state === "half_open",
    live: generations.live,
    active: generations.active,
  };
}

/**
 * Whether the cron should start the projector: `due` when it can write and
 * has a rebuild to advance, changes to project, a backend to probe or a
 * daily drift check to run. Reads Turso only.
 */
export type SearchProjectorDue =
  | Exclude<Gate, { status: "open" }>
  | Extract<SearchProjectorStepResult, { status: "rebuild_waiting" }>
  | { status: "current"; projectedThrough: number; horizon: number }
  | {
      status: "due";
      reason: "rebuild" | "changes" | "probe" | "drift_check";
      projectedThrough: number;
      horizon: number;
    };

/**
 * Whether Turso holds vehicle writes the outbox horizon does not cover yet:
 * a run is reconciling, or changes exist past the horizon. A drift check
 * then would count vehicles the index cannot have yet.
 */
async function writesInFlight(
  database: LibSQLDatabase,
  horizon: number,
): Promise<boolean> {
  const result = await database.run(sql`
    select (
      exists (
        select 1 from ingestion_run
        where active_slot = 1
          and stage in ('reconcile_upsert', 'reconcile_missing')
      )
      or exists (select 1 from vehicle_change_v2 where id > ${horizon})
    ) as in_flight
  `);
  return Number(result.rows[0]?.in_flight ?? 0) === 1;
}

function rebuildWaiting(
  generation: ActiveSearchIndexGeneration,
  wait: SearchRebuildWait,
): SearchProjectorStepResult {
  return {
    status: "rebuild_waiting",
    generationId: generation.id,
    reason: wait.reason,
    retryAt: wait.retryAt.toISOString(),
  };
}

/** One rebuild step, or the request that starts the first rebuild. */
async function rebuildStep(
  context: SearchProjectorContext,
  active: ActiveSearchIndexGeneration | null,
): Promise<SearchProjectorStepResult> {
  if (active === null) {
    const now = context.now();
    const request = await SearchIndexGenerations.request(context.database, {
      environment: context.environment,
      indexName: context.indexName,
      reason: "bootstrap",
      now,
    });
    switch (request.status) {
      case "requested":
        return {
          status: "rebuild_requested",
          generationId: request.id,
          reason: "bootstrap",
        };
      case "in_flight":
        return { status: "stopped" };
      case "foreign":
        return {
          status: "environment_mismatch",
          generationEnvironment: request.environment,
        };
    }
  }
  const advanced = await Effect.runPromise(
    Effect.either(SearchIndexRebuild.advance(context, active)),
  );
  if (Either.isLeft(advanced)) return recordFailure(context, advanced.left, 0);
  const result = advanced.right;
  // A rebuild step that wrote closes the circuit, as a projected batch does.
  if (
    result.status === "rebuild_prepared" ||
    result.status === "rebuild_loading"
  ) {
    await SearchProjectorCheckpoint.recordSuccess(
      context.database,
      context.now(),
    );
  }
  return result;
}

async function recordFailure(
  context: SearchProjectorContext,
  error: AlgoliaError,
  changes: number,
): Promise<SearchProjectorStepResult> {
  const backoff = await SearchProjectorCheckpoint.recordFailure(
    context.database,
    { tag: error._tag, now: context.now() },
  );
  return {
    status: "failed",
    tag: error._tag,
    message: error.message,
    failureCount: backoff.failureCount,
    retryAt: backoff.retryAt.toISOString(),
    opened: backoff.opened,
    changes,
  };
}

/**
 * The singleton search projector: the only search writer once publication
 * is decoupled. Each step reads `vehicle_change_v2` past its checkpoint up to
 * the horizon (no change of a run still reconciling), collapses the changes
 * per VIN, re-reads the current vehicle rows, writes them to the live index
 * (or deletes them), waits for the backend, and advances its checkpoint.
 * Writes are idempotent, so a step that dies before advancing is redone.
 */
export const SearchProjector = {
  async due(
    database: LibSQLDatabase,
    environment: string,
    now: Date,
  ): Promise<SearchProjectorDue> {
    const opened = await gate(database, environment, now);
    if (opened.status !== "open") return opened;
    const horizon = await SearchOutbox.horizon(database);
    const position = { projectedThrough: opened.projectedThrough, horizon };
    const { active } = opened;
    const wait =
      active?.status === "requested"
        ? await SearchRebuildWait.read(database, now)
        : null;
    const waiting = (generation: ActiveSearchIndexGeneration) =>
      wait === null
        ? null
        : ({
            status: "rebuild_waiting",
            generationId: generation.id,
            reason: wait.reason,
            retryAt: wait.retryAt.toISOString(),
          } as const);
    if (
      opened.live === null ||
      (active !== null && active.status !== "requested")
    ) {
      return (
        (active && waiting(active)) ?? {
          status: "due",
          reason: "rebuild",
          ...position,
        }
      );
    }
    if (opened.probe) return { status: "due", reason: "probe", ...position };
    if (horizon > opened.projectedThrough) {
      return { status: "due", reason: "changes", ...position };
    }
    if (active !== null) {
      return (
        waiting(active) ?? { status: "due", reason: "rebuild", ...position }
      );
    }
    if (
      (await SearchIndexDrift.due(database, now)) &&
      !(await writesInFlight(database, horizon))
    ) {
      return { status: "due", reason: "drift_check", ...position };
    }
    return { status: "current", ...position };
  },

  async step(
    context: SearchProjectorContext,
    options?: { budgetMs?: number },
  ): Promise<SearchProjectorStepResult> {
    const startedAt = context.now().getTime();
    const deadline = startedAt + (options?.budgetMs ?? STEP_BUDGET_MS);
    const opened = await gate(
      context.database,
      context.environment,
      context.now(),
    );
    if (opened.status !== "open") return opened;
    await SearchProjectorCheckpoint.ensure(context.database, context.now());
    if (opened.probe) {
      // A cheap read before writing again; it sends no search.
      const probe = await Effect.runPromise(
        Effect.either(context.writer.metadata(context.indexName)),
      );
      // A passing probe lets this step write, but only a write that lands
      // closes the circuit: reads can pass while writes stay refused (a
      // used-up record quota), and the backoff must keep growing then.
      if (Either.isLeft(probe)) return recordFailure(context, probe.left, 0);
    }
    // The first rebuild, or one already copying or moving, comes before
    // changes: they are replayed from its snapshot once it is live. A
    // requested rebuild with a live index waits until changes are caught up,
    // so a rebuild that cannot start never stops the live index's updates.
    const { active } = opened;
    if (
      opened.live === null ||
      (active !== null && active.status !== "requested")
    ) {
      if (active?.status === "requested") {
        const wait = await SearchRebuildWait.read(
          context.database,
          context.now(),
        );
        if (wait) return rebuildWaiting(active, wait);
      }
      return rebuildStep(context, active);
    }

    const from = opened.projectedThrough;
    let cursor = from;
    let horizon = await SearchOutbox.horizon(context.database);
    const totals = { changes: 0, upserted: 0, deleted: 0, deadLettered: 0 };
    while (true) {
      const batch = await Effect.runPromise(
        Effect.either(projectBatch(context, cursor, horizon)),
      );
      if (Either.isLeft(batch)) {
        return recordFailure(context, batch.left, totals.changes);
      }
      const outcome = batch.right;
      if (outcome.status === "stopped") return { status: "stopped" };
      if (outcome.status === "empty") break;
      cursor = outcome.to;
      totals.changes += outcome.changes;
      totals.upserted += outcome.upserted;
      totals.deleted += outcome.deleted;
      totals.deadLettered += outcome.deadLettered;
      if (context.now().getTime() >= deadline) break;
      // Runs that finished during the step are projected in this step too,
      // unless one entered an inline search stage meanwhile.
      if (cursor >= horizon) {
        if ((await inlineWriterRuns(context.database)).length > 0) break;
        horizon = await SearchOutbox.horizon(context.database);
        if (cursor >= horizon) break;
      }
    }
    if (cursor === from) {
      // Nothing to write, so the passing probe is the only evidence.
      if (opened.probe) {
        await SearchProjectorCheckpoint.recordSuccess(
          context.database,
          context.now(),
        );
      }
      // Runs that finished without new changes (or only inherited a
      // rebuild) are settled even when there is nothing to write.
      await context.client.batch(
        [SearchProjectorCheckpoint.clearSettledRebuildsStatement(cursor)],
        "write",
      );
      // Caught up: a requested rebuild starts from here.
      if (active !== null) {
        const wait = await SearchRebuildWait.read(
          context.database,
          context.now(),
        );
        return wait
          ? rebuildWaiting(active, wait)
          : rebuildStep(context, active);
      }
      // Caught up with no run writing: the index should match Turso.
      if (
        (await SearchIndexDrift.due(context.database, context.now())) &&
        !(await writesInFlight(context.database, horizon))
      ) {
        const drift = await Effect.runPromise(
          Effect.either(SearchIndexDrift.check(context)),
        );
        if (Either.isLeft(drift)) return recordFailure(context, drift.left, 0);
        return drift.right;
      }
      return { status: "current", projectedThrough: cursor, horizon };
    }
    return {
      status: "projected",
      from,
      projectedThrough: cursor,
      horizon,
      ...totals,
      caughtUp: cursor >= horizon,
    };
  },
} as const;
