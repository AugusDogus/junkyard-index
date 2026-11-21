import { and, desc, eq, inArray } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { searchIndexGeneration } from "~/schema";

type GenerationRow = typeof searchIndexGeneration.$inferSelect;

/** Why a rebuild was requested. */
export type SearchIndexGenerationReason = "bootstrap" | "operator" | "drift";

interface GenerationBase {
  id: string;
  /** The deployment whose index this is (production, preview, ...). */
  environment: string;
  /** The live index name the generation serves. */
  indexName: string;
  reason: SearchIndexGenerationReason;
  requestedAt: Date;
}

/**
 * One generation of the search index, built from the `vehicle` table into a
 * temporary index and moved over the live one.
 *
 * - requested: waiting to prepare its temporary index.
 * - loading: copying vehicles in VIN order, resumable from `vinCursor`.
 * - moving: the move over the live index is requested or in flight. It is
 *   never discarded: its task id, once recorded, is waited for.
 * - live: the generation the live index holds. At most one per environment.
 * - superseded / discarded: ended; its temporary index is deleted once
 *   `tempIndexDeletedAt` is set.
 */
export type SearchIndexGeneration =
  | (GenerationBase & { status: "requested" })
  | (GenerationBase & {
      status: "loading";
      tempIndexName: string;
      /** The outbox horizon when loading began; replay starts after it. */
      snapshotChangeId: number;
      vinCursor: string | null;
      recordsLoaded: number;
      startedAt: Date;
    })
  | (GenerationBase & {
      status: "moving";
      tempIndexName: string;
      snapshotChangeId: number;
      moveTaskId: number | null;
      recordsLoaded: number;
      startedAt: Date;
    })
  | (GenerationBase & {
      status: "live";
      snapshotChangeId: number | null;
      liveAt: Date;
    })
  | (GenerationBase & {
      status: "superseded" | "discarded";
      tempIndexName: string | null;
      tempIndexDeletedAt: Date | null;
      endedAt: Date;
      lastError: string | null;
    });

const REASONS: readonly SearchIndexGenerationReason[] = [
  "bootstrap",
  "operator",
  "drift",
];

function parseReason(row: GenerationRow): SearchIndexGenerationReason {
  const reason = REASONS.find((candidate) => candidate === row.reason);
  if (reason === undefined) {
    throw new Error(
      `Search index generation ${row.id} has unknown reason ${row.reason}. Fix the row in search_index_generation; the search projector refuses to act on it until then.`,
    );
  }
  return reason;
}

function required<T>(row: GenerationRow, field: string, value: T | null): T {
  if (value === null) {
    throw new Error(
      `Search index generation ${row.id} is ${row.status} without ${field}. The row is inconsistent; the search projector refuses to act on it. Mark it discarded in search_index_generation to let a new rebuild start.`,
    );
  }
  return value;
}

/** Parses a row at the repository boundary; a malformed row throws. */
function parse(row: GenerationRow): SearchIndexGeneration {
  const base: GenerationBase = {
    id: row.id,
    environment: row.environment,
    indexName: row.indexName,
    reason: parseReason(row),
    requestedAt: row.requestedAt,
  };
  switch (row.status) {
    case "requested":
      return { ...base, status: "requested" };
    case "loading":
      return {
        ...base,
        status: "loading",
        tempIndexName: required(row, "temp_index_name", row.tempIndexName),
        snapshotChangeId: required(
          row,
          "snapshot_change_id",
          row.snapshotChangeId,
        ),
        vinCursor: row.vinCursor,
        recordsLoaded: row.recordsLoaded,
        startedAt: required(row, "started_at", row.startedAt),
      };
    case "moving":
      return {
        ...base,
        status: "moving",
        tempIndexName: required(row, "temp_index_name", row.tempIndexName),
        snapshotChangeId: required(
          row,
          "snapshot_change_id",
          row.snapshotChangeId,
        ),
        moveTaskId: row.moveTaskId,
        recordsLoaded: row.recordsLoaded,
        startedAt: required(row, "started_at", row.startedAt),
      };
    case "live":
      return {
        ...base,
        status: "live",
        snapshotChangeId: row.snapshotChangeId,
        liveAt: required(row, "live_at", row.liveAt),
      };
    case "superseded":
    case "discarded":
      return {
        ...base,
        status: row.status,
        tempIndexName: row.tempIndexName,
        tempIndexDeletedAt: row.tempIndexDeletedAt,
        endedAt: required(row, "ended_at", row.endedAt),
        lastError: row.lastError,
      };
    default:
      throw new Error(
        `Search index generation ${row.id} has unknown status ${row.status}. Fix the row in search_index_generation; the search projector refuses to act on it until then.`,
      );
  }
}

export type ActiveSearchIndexGeneration = Extract<
  SearchIndexGeneration,
  { status: "requested" | "loading" | "moving" }
>;
export type LiveSearchIndexGeneration = Extract<
  SearchIndexGeneration,
  { status: "live" }
>;

/**
 * The generations a deployment may act on. `foreign`: the database already
 * holds an in-flight or live generation of another deployment's index, so
 * this one must not write (a preview against a shared database, say).
 */
export type EnvironmentGenerations =
  | { status: "foreign"; environment: string }
  | {
      status: "own";
      live: LiveSearchIndexGeneration | null;
      active: ActiveSearchIndexGeneration | null;
    };

const CURRENT_STATUSES = ["requested", "loading", "moving", "live"];

export const SearchIndexGenerations = {
  parse,

  /** The live and in-flight generations, fenced to one environment. */
  async forEnvironment(
    database: LibSQLDatabase,
    environment: string,
  ): Promise<EnvironmentGenerations> {
    const rows = await database
      .select()
      .from(searchIndexGeneration)
      .where(inArray(searchIndexGeneration.status, CURRENT_STATUSES))
      .orderBy(desc(searchIndexGeneration.requestedAt));
    const foreign = rows.find((row) => row.environment !== environment);
    if (foreign) return { status: "foreign", environment: foreign.environment };
    const generations = rows.map(parse);
    return {
      status: "own",
      live:
        generations.find(
          (generation): generation is LiveSearchIndexGeneration =>
            generation.status === "live",
        ) ?? null,
      active:
        generations.find(
          (generation): generation is ActiveSearchIndexGeneration =>
            generation.status !== "live",
        ) ?? null,
    };
  },

  /** One generation by id, parsed. */
  async get(
    database: LibSQLDatabase,
    id: string,
  ): Promise<SearchIndexGeneration | null> {
    const [row] = await database
      .select()
      .from(searchIndexGeneration)
      .where(and(eq(searchIndexGeneration.id, id)))
      .limit(1);
    return row ? parse(row) : null;
  },
} as const;
