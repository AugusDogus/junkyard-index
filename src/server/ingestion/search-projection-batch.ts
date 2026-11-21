import type { Client } from "@libsql/client";
import { asc, inArray } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { Effect } from "effect";
import type { AlgoliaErrorTag } from "~/lib/algolia-failure-tag";
import { vehicle } from "~/schema";
import type { AlgoliaError } from "./algolia-error";
import type { SearchIndexWriter } from "./search-index-writer";
import type { OutboxChange } from "./search-outbox";
import type { AlgoliaVehicleRecord } from "./types";

// Shared by the search projector's incremental path and its rebuilds.

export type VehicleRow = typeof vehicle.$inferSelect;

const VEHICLE_READ_CHUNK = 1_000;
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
export interface DeadLetter {
  changeId: number;
  vin: string;
  tag: AlgoliaErrorTag;
  detail: string;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function truncate(detail: string): string {
  return detail.length > DETAIL_LIMIT
    ? `${detail.slice(0, DETAIL_LIMIT - 1)}…`
    : detail;
}

/** The latest change per VIN: a delete deletes, anything else re-reads. */
export function collapse(changes: readonly OutboxChange[]) {
  const latest = new Map<string, OutboxChange>();
  for (const change of changes) {
    const previous = latest.get(change.vin);
    if (!previous || change.id > previous.id) latest.set(change.vin, change);
  }
  return [...latest.values()];
}

export async function readVehicles(
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

export type SaveOutcome = {
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
export function saveIsolating(
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

/** Records a dead letter, but only if the batch's cursor write applied. */
export function deadLetterStatement(params: {
  letter: DeadLetter;
  environment: string;
  indexName: string;
  now: Date;
  /** An SQL condition that holds only when the batch's checkpoint moved. */
  guard: { sql: string; args: Array<string | number | null> };
}) {
  return {
    sql: `
      insert into search_dead_letter (
        change_id, vin, environment, index_name, error_tag, detail,
        created_at
      )
      select ?, ?, ?, ?, ?, ?, ?
      where ${params.guard.sql}
    `,
    args: [
      params.letter.changeId,
      params.letter.vin,
      params.environment,
      params.indexName,
      params.letter.tag,
      params.letter.detail,
      params.now.getTime(),
      ...params.guard.args,
    ],
  };
}
