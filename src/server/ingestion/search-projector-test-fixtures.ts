import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { Effect } from "effect";
import { readFileSync } from "node:fs";
import { vehicle } from "~/schema";
import {
  InvalidRequest,
  NotFound,
  QuotaExceeded,
  SearchBackendBlocked,
  Transient,
  type AlgoliaError,
} from "./algolia-error";
import { mapDbVehicleToAlgolia } from "./algolia-projector-helpers";
import { RECONCILIATION_TEST_SCHEMA } from "./durable-reconciliation-test-fixtures";
import type { SearchProjectorContext } from "./search-projector";
import type {
  SearchIndexListing,
  SearchIndexMetadata,
  SearchIndexWriter,
} from "./search-index-writer";
import type { AlgoliaVehicleRecord } from "./types";

export const SEARCH_PROJECTOR_TEST_SCHEMA = `
${RECONCILIATION_TEST_SCHEMA}
${readFileSync(new URL("../../../drizzle/0025_search_projector.sql", import.meta.url), "utf8").replaceAll("--> statement-breakpoint", "")}
`;

export const INDEX = "vehicles";

type FailureTag =
  | "SearchBackendBlocked"
  | "QuotaExceeded"
  | "NotFound"
  | "InvalidRequest"
  | "Transient";

/** Builds a tagged Algolia failure without a request. */
export function algoliaFailure(
  tag: FailureTag,
  detail: string = tag,
  indexName: string = INDEX,
): AlgoliaError {
  const fields = {
    operation: "saveObjects",
    indexName,
    status:
      tag === "Transient"
        ? null
        : tag === "InvalidRequest"
          ? 400
          : tag === "NotFound"
            ? 404
            : 403,
    detail,
    message: `Algolia saveObjects failed (${tag}): ${detail}`,
    cause: null,
  };
  switch (tag) {
    case "SearchBackendBlocked":
      return new SearchBackendBlocked(fields);
    case "QuotaExceeded":
      return new QuotaExceeded(fields);
    case "NotFound":
      return new NotFound(fields);
    case "InvalidRequest":
      return new InvalidRequest(fields);
    case "Transient":
      return new Transient(fields);
  }
}

type WriterCall =
  | { op: "save"; indexName: string; objectIDs: string[] }
  | { op: "delete"; indexName: string; objectIDs: string[] }
  | { op: "wait"; indexName: string; taskId: number }
  | { op: "metadata"; indexName: string }
  | { op: "list" }
  | { op: "prepare"; from: string; to: string; generation: string }
  | { op: "move"; from: string; to: string }
  | { op: "deleteIndex"; indexName: string };

/** An index in the fake backend. */
export interface FakeIndex {
  records: Map<string, AlgoliaVehicleRecord>;
  generation: string | null;
  schemaVersion: number;
}

/**
 * A search backend held in memory. It records every call and answers from
 * its indices, or with the failure `behavior` returns; it never sends a
 * request.
 */
export function fakeWriter(behavior?: {
  save?: (records: readonly AlgoliaVehicleRecord[]) => AlgoliaError | null;
  metadata?: () => AlgoliaError | SearchIndexMetadata;
  /** A failure for any other operation on an index, or null. */
  fail?: (op: WriterCall["op"], indexName: string) => AlgoliaError | null;
  /** Indices `listIndices` reports besides the fake's own (replicas, say). */
  extraListings?: SearchIndexListing[];
  /** Runs while a task is waited for, to land work Algolia had queued. */
  onWait?: (indexName: string, taskId: number) => void;
}) {
  const calls: WriterCall[] = [];
  const indices = new Map<string, FakeIndex>();
  let task = 0;
  const index = (name: string): FakeIndex => {
    const existing = indices.get(name);
    if (existing) return existing;
    const created: FakeIndex = {
      records: new Map(),
      generation: null,
      schemaVersion: 0,
    };
    indices.set(name, created);
    return created;
  };
  const failure = (op: WriterCall["op"], indexName: string) =>
    behavior?.fail?.(op, indexName) ?? null;
  const writer: SearchIndexWriter = {
    saveObjects(indexName, records) {
      calls.push({
        op: "save",
        indexName,
        objectIDs: records.map((record) => record.objectID),
      });
      const failed = behavior?.save?.(records) ?? failure("save", indexName);
      if (failed) return Effect.fail(failed);
      const target = index(indexName);
      for (const record of records) target.records.set(record.objectID, record);
      task += 1;
      return Effect.succeed(records.length === 0 ? null : task);
    },
    deleteObjects(indexName, objectIDs) {
      calls.push({ op: "delete", indexName, objectIDs: [...objectIDs] });
      const failed = failure("delete", indexName);
      if (failed) return Effect.fail(failed);
      const target = index(indexName);
      for (const objectID of objectIDs) target.records.delete(objectID);
      task += 1;
      return Effect.succeed(objectIDs.length === 0 ? null : task);
    },
    waitForTask(indexName, taskId) {
      calls.push({ op: "wait", indexName, taskId });
      behavior?.onWait?.(indexName, taskId);
      const failed = failure("wait", indexName);
      return failed ? Effect.fail(failed) : Effect.void;
    },
    metadata(indexName) {
      calls.push({ op: "metadata", indexName });
      if (behavior?.metadata) {
        const answer = behavior.metadata();
        return "_tag" in answer ? Effect.fail(answer) : Effect.succeed(answer);
      }
      const failed = failure("metadata", indexName);
      if (failed) return Effect.fail(failed);
      const found = indices.get(indexName);
      if (!found && indexName !== INDEX) {
        return Effect.fail(
          algoliaFailure("NotFound", "Index does not exist", indexName),
        );
      }
      return Effect.succeed({
        generation: found?.generation ?? null,
        schemaVersion: found?.schemaVersion ?? 0,
      });
    },
    listIndices() {
      calls.push({ op: "list" });
      const failed = failure("list", "");
      if (failed) return Effect.fail(failed);
      return Effect.succeed([
        ...[...indices.entries()].map(([name, found]) => ({
          name,
          entries: found.records.size,
          primary: null,
          replicas: [],
          virtual: false,
        })),
        ...(behavior?.extraListings ?? []),
      ]);
    },
    prepareIndex({ from, to, generation }) {
      calls.push({ op: "prepare", from, to, generation });
      const failed = failure("prepare", to);
      if (failed) return Effect.fail(failed);
      const source = indices.get(from);
      if (!source) return Effect.succeed("missing_source");
      indices.set(to, {
        records: new Map(),
        generation,
        schemaVersion: source.schemaVersion,
      });
      return Effect.succeed("copied");
    },
    moveIndex(from, to) {
      calls.push({ op: "move", from, to });
      const failed = failure("move", from);
      if (failed) return Effect.fail(failed);
      const source = indices.get(from);
      if (!source) {
        return Effect.fail(
          algoliaFailure("NotFound", "Index does not exist", from),
        );
      }
      indices.set(to, source);
      indices.delete(from);
      task += 1;
      return Effect.succeed(task);
    },
    deleteIndex(indexName) {
      calls.push({ op: "deleteIndex", indexName });
      const failed = failure("deleteIndex", indexName);
      if (failed) return Effect.fail(failed);
      indices.delete(indexName);
      return Effect.void;
    },
  };
  return { writer, calls, indices };
}

export function vehicleRow(
  vin: string,
  overrides?: Partial<typeof vehicle.$inferSelect>,
): typeof vehicle.$inferSelect {
  return {
    vin,
    source: "pyp",
    year: 2004,
    make: "Honda",
    model: "Civic",
    sourceMake: null,
    sourceModel: null,
    color: null,
    stockNumber: null,
    imageUrl: null,
    availableDate: null,
    observedArrivalAt: null,
    locationCode: "yard-1",
    locationName: "Yard",
    locationCity: "Fresno",
    state: "California",
    stateAbbr: "CA",
    lat: 36.7,
    lng: -119.8,
    section: null,
    row: null,
    space: null,
    detailsUrl: null,
    partsUrl: null,
    pricesUrl: null,
    engine: null,
    trim: null,
    transmission: null,
    firstSeenAt: new Date("2026-11-20T08:00:00Z"),
    lastSeenAt: new Date("2026-11-20T08:00:00Z"),
    missingSinceAt: null,
    missingRunCount: 0,
    ...overrides,
  };
}

export async function createProjectorDatabase() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(SEARCH_PROJECTOR_TEST_SCHEMA);
  return { client, database: drizzle(client) };
}

/** A projector context over the test database with a controllable clock. */
export function projectorContext(params: {
  client: Client;
  database: LibSQLDatabase;
  writer: SearchIndexWriter;
  clock: { now: Date };
  environment?: string;
}): SearchProjectorContext {
  return {
    database: params.database,
    client: params.client,
    writer: params.writer,
    environment: params.environment ?? "production",
    indexName: INDEX,
    // The real record mapping, without the yard metadata lookup.
    project: async (rows) => rows.map(mapDbVehicleToAlgolia),
    now: () => params.clock.now,
  };
}

/** Inserts a run, its change rows (in order) and returns their ids. */
export async function insertRunWithChanges(
  client: Client,
  run: {
    id: string;
    status: string;
    stage: string;
    activeSlot: 1 | null;
    fullReindexRequired?: boolean;
  },
  changes: ReadonlyArray<readonly [vin: string, changeType: string]>,
): Promise<number[]> {
  await client.execute({
    sql: `insert into ingestion_run (
      id, source, status, stage, active_slot, full_reindex_required,
      started_at, last_progress_at
    ) values (?, 'pyp', ?, ?, ?, ?, 0, 0)`,
    args: [
      run.id,
      run.status,
      run.stage,
      run.activeSlot,
      Number(run.fullReindexRequired ?? false),
    ],
  });
  const ids: number[] = [];
  for (const [vin, changeType] of changes) {
    const inserted = await client.execute({
      sql: `insert into vehicle_change_v2 (
        run_id, vin, change_type, payload_version, created_at
      ) values (?, ?, ?, 1, ?) returning id`,
      args: [run.id, vin, changeType, Date.parse("2026-11-20T09:00:00Z")],
    });
    ids.push(Number(inserted.rows[0]?.id));
  }
  return ids;
}

export async function insertLiveGeneration(
  client: Client,
  environment = "production",
): Promise<void> {
  await client.execute({
    sql: `insert into search_index_generation (
      id, environment, index_name, status, reason, requested_at, live_at,
      updated_at
    ) values ('live-1', ?, ?, 'live', 'bootstrap', 0, 0, 0)`,
    args: [environment, INDEX],
  });
}

export async function projectedThrough(client: Client): Promise<number> {
  const result = await client.execute(
    "select last_processed_change_id from ingestion_projector_checkpoint where name = 'search-projector'",
  );
  return Number(result.rows[0]?.last_processed_change_id ?? 0);
}
