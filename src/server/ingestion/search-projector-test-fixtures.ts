import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { Effect } from "effect";
import { readFileSync } from "node:fs";
import { vehicle } from "~/schema";
import {
  InvalidRequest,
  QuotaExceeded,
  SearchBackendBlocked,
  Transient,
  type AlgoliaError,
} from "./algolia-error";
import { mapDbVehicleToAlgolia } from "./algolia-projector-helpers";
import { RECONCILIATION_TEST_SCHEMA } from "./durable-reconciliation-test-fixtures";
import type { SearchProjectorContext } from "./search-projector";
import type {
  SearchIndexMetadata,
  SearchIndexWriter,
} from "./search-index-writer";
import type { AlgoliaVehicleRecord } from "./types";

export const SEARCH_PROJECTOR_TEST_SCHEMA = `
${RECONCILIATION_TEST_SCHEMA}
${readFileSync(new URL("../../../drizzle/0025_search_projector.sql", import.meta.url), "utf8").replaceAll("--> statement-breakpoint", "")}
`;

export const INDEX = "vehicles";

/** Builds a tagged Algolia failure without a request. */
export function algoliaFailure(
  tag:
    | "SearchBackendBlocked"
    | "QuotaExceeded"
    | "InvalidRequest"
    | "Transient",
  detail: string = tag,
): AlgoliaError {
  const fields = {
    operation: "saveObjects",
    indexName: INDEX,
    status: tag === "Transient" ? null : tag === "InvalidRequest" ? 400 : 403,
    detail,
    message: `Algolia saveObjects failed (${tag}): ${detail}`,
    cause: null,
  };
  switch (tag) {
    case "SearchBackendBlocked":
      return new SearchBackendBlocked(fields);
    case "QuotaExceeded":
      return new QuotaExceeded(fields);
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
  | { op: "metadata"; indexName: string };

/**
 * A search writer that records every call and answers from `behavior`; it
 * never sends a request.
 */
export function fakeWriter(behavior?: {
  save?: (records: readonly AlgoliaVehicleRecord[]) => AlgoliaError | null;
  metadata?: () => AlgoliaError | SearchIndexMetadata;
}) {
  const calls: WriterCall[] = [];
  let task = 0;
  const writer: SearchIndexWriter = {
    saveObjects(indexName, records) {
      calls.push({
        op: "save",
        indexName,
        objectIDs: records.map((record) => record.objectID),
      });
      const failure = behavior?.save?.(records) ?? null;
      if (failure) return Effect.fail(failure);
      task += 1;
      return Effect.succeed(records.length === 0 ? null : task);
    },
    deleteObjects(indexName, objectIDs) {
      calls.push({ op: "delete", indexName, objectIDs: [...objectIDs] });
      task += 1;
      return Effect.succeed(objectIDs.length === 0 ? null : task);
    },
    waitForTask(indexName, taskId) {
      calls.push({ op: "wait", indexName, taskId });
      return Effect.void;
    },
    metadata(indexName) {
      calls.push({ op: "metadata", indexName });
      const answer = behavior?.metadata?.() ?? {
        generation: null,
        schemaVersion: 0,
      };
      return "_tag" in answer ? Effect.fail(answer) : Effect.succeed(answer);
    },
  };
  return { writer, calls };
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
