import type { Client, InStatement } from "@libsql/client";
import { asc, inArray } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { Effect, Either } from "effect";
import type { AlgoliaErrorTag } from "~/lib/algolia-failure-tag";
import { vehicle } from "~/schema";
import type { AlgoliaError } from "./algolia-error";
import { SearchIndexGenerations } from "./search-index-generation";
import type { SearchIndexWriter } from "./search-index-writer";
import { SearchOutbox, type OutboxChange } from "./search-outbox";
import { SearchProjectorCheckpoint } from "./search-projector-checkpoint";
import type { AlgoliaVehicleRecord } from "./types";

type VehicleRow = typeof vehicle.$inferSelect;

/** Changes read per batch; a step runs several batches. */
const CHANGE_BATCH_SIZE = 5_000;
const VEHICLE_READ_CHUNK = 1_000;
// Leave room in a workflow step for the batch that is already running.
const STEP_BUDGET_MS = 180_000;
const DETAIL_LIMIT = 1_000;

/** Everything the projector reads and writes, injected so tests use fakes. */
export interface SearchProjectorContext {
  database: LibSQLDatabase;
  client: Pick<Client, "batch">;
  writer: SearchIndexWriter;
  /** The runtime's deployment; generations from another one are fenced off. */
  environment: string;
  /** The live index this deployment serves. */
  indexName: string;
  /** Turns vehicle rows into search records (projectSearchVehicles). */
  project(rows: readonly VehicleRow[]): Promise<AlgoliaVehicleRecord[]>;
  now(): Date;
}

/** A record the backend rejected, kept for an operator. */
interface DeadLetter {
  changeId: number;
  vin: string;
  tag: AlgoliaErrorTag;
  detail: string;
}

/**
 * One projector step's outcome. Every variant is plain data (a workflow step
 * result). Nothing here ever writes `ingestion_run`.
 *
 * - inline_writer_active: a run still publishes search inline; the projector
 *   writes nothing until it releases (single-writer invariant).
 * - environment_mismatch: the database's search generations belong to
 *   another deployment's index; this deployment refuses to write.
 * - rebuild_required: no live generation describes the index yet.
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
  | { status: "rebuild_required" }
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

function truncate(detail: string): string {
  return detail.length > DETAIL_LIMIT
    ? `${detail.slice(0, DETAIL_LIMIT - 1)}…`
    : detail;
}

/** The latest change per VIN: a delete deletes, anything else re-reads. */
function collapse(changes: readonly OutboxChange[]) {
  const latest = new Map<string, OutboxChange>();
  for (const change of changes) {
    const previous = latest.get(change.vin);
    if (!previous || change.id > previous.id) latest.set(change.vin, change);
  }
  return [...latest.values()];
}

async function readVehicles(
  database: LibSQLDatabase,
  vins: readonly string[],
): Promise<Map<string, VehicleRow>> {
  const rows = new Map<string, VehicleRow>();
  for (let index = 0; index < vins.length; index += VEHICLE_READ_CHUNK) {
    const chunk = vins.slice(index, index + VEHICLE_READ_CHUNK);
    const found = await database
      .select()
      .from(vehicle)
      .where(inArray(vehicle.vin, chunk))
      .orderBy(asc(vehicle.vin));
    for (const row of found) rows.set(row.vin, row);
  }
  return rows;
}

type SaveOutcome = {
  taskIds: number[];
  rejected: Array<{ record: AlgoliaVehicleRecord; error: AlgoliaError }>;
};

/**
 * Whether an invalid-request answer can be about the records sent: a 401 or
 * 403 refuses the key or the operation, whatever the records, so it fails
 * the whole batch instead of being pinned on records.
 */
function rejectsRecords(error: AlgoliaError): boolean {
  return error.status !== 401 && error.status !== 403;
}

/**
 * Saves records; when the backend rejects the request as invalid, halves it
 * until the rejected records are isolated, so bad records cannot hold back
 * the outbox, however many there are. Any other failure, and a refused key
 * or operation, fails the whole save.
 */
function saveIsolating(
  writer: SearchIndexWriter,
  indexName: string,
  records: readonly AlgoliaVehicleRecord[],
): Effect.Effect<SaveOutcome, AlgoliaError> {
  if (records.length === 0) {
    return Effect.succeed({ taskIds: [], rejected: [] });
  }
  return writer.saveObjects(indexName, records).pipe(
    Effect.map(
      (taskId): SaveOutcome => ({
        taskIds: taskId === null ? [] : [taskId],
        rejected: [],
      }),
    ),
    Effect.catchTag("InvalidRequest", (error) => {
      if (!rejectsRecords(error)) return Effect.fail(error);
      const [only] = records;
      if (records.length === 1 && only !== undefined) {
        return Effect.succeed<SaveOutcome>({
          taskIds: [],
          rejected: [{ record: only, error }],
        });
      }
      const middle = Math.ceil(records.length / 2);
      return Effect.gen(function* () {
        const left = yield* saveIsolating(
          writer,
          indexName,
          records.slice(0, middle),
        );
        const right = yield* saveIsolating(
          writer,
          indexName,
          records.slice(middle),
        );
        return {
          taskIds: [...left.taskIds, ...right.taskIds],
          rejected: [...left.rejected, ...right.rejected],
        };
      });
    }),
  );
}

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
      ...deadLetters.map((letter) => ({
        sql: `
          insert into search_dead_letter (
            change_id, vin, environment, index_name, error_tag, detail,
            created_at
          )
          select ?, ?, ?, ?, ?, ?, ?
          where exists (
            select 1 from ingestion_projector_checkpoint
            where name = ? and last_processed_change_id = ?
              and last_success_at = ?
          )
        `,
        args: [
          letter.changeId,
          letter.vin,
          context.environment,
          context.indexName,
          letter.tag,
          letter.detail,
          now.getTime(),
          SearchProjectorCheckpoint.name,
          last.id,
          now.getTime(),
        ],
      })),
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
  | { status: "rebuild_required" }
  | {
      status: "circuit_open";
      tag: AlgoliaErrorTag;
      failureCount: number;
      /** ISO time. */
      retryAt: string;
    }
  | { status: "open"; projectedThrough: number; probe: boolean };

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
  if (generations.live === null) return { status: "rebuild_required" };
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
  };
}

/**
 * Whether the cron should start the projector: `due` when it can write and
 * has changes to project or a backend to probe. Reads Turso only.
 */
export type SearchProjectorDue =
  | Exclude<Gate, { status: "open" }>
  | { status: "current"; projectedThrough: number; horizon: number }
  | {
      status: "due";
      projectedThrough: number;
      horizon: number;
      probe: boolean;
    };

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
    if (opened.probe || horizon > opened.projectedThrough) {
      return {
        status: "due",
        projectedThrough: opened.projectedThrough,
        horizon,
        probe: opened.probe,
      };
    }
    return {
      status: "current",
      projectedThrough: opened.projectedThrough,
      horizon,
    };
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
