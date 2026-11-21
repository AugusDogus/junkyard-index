import type { InStatement } from "@libsql/client";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
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

/** What requesting a rebuild did. */
export type SearchIndexGenerationRequest =
  | { status: "requested"; id: string }
  /** A rebuild was already in flight for the environment. */
  | { status: "in_flight" }
  /** The database's generations belong to another environment. */
  | { status: "foreign"; environment: string };

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
      .where(eq(searchIndexGeneration.id, id))
      .limit(1);
    return row ? parse(row) : null;
  },

  /** The temporary index a generation loads into. */
  tempIndexName(indexName: string, id: string): string {
    return `${indexName}__generation_${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  },

  /**
   * Requests a rebuild unless one is already in flight for the environment
   * (the partial unique index allows one), or the database's generations
   * belong to another environment (the same fence the projector applies):
   * a preview pointed at the production database must not stop production.
   */
  async request(
    database: LibSQLDatabase,
    params: {
      environment: string;
      indexName: string;
      reason: SearchIndexGenerationReason;
      now: Date;
    },
  ): Promise<SearchIndexGenerationRequest> {
    const id = crypto.randomUUID();
    const inserted = await database.run(sql`
      insert into search_index_generation (
        id, environment, index_name, status, reason, requested_at, updated_at
      )
      select ${id}, ${params.environment}, ${params.indexName}, 'requested',
        ${params.reason}, ${params.now.getTime()}, ${params.now.getTime()}
      where not exists (
        select 1 from search_index_generation
        where environment <> ${params.environment}
          and status in ('requested', 'loading', 'moving', 'live')
      )
      on conflict do nothing
    `);
    if (inserted.rowsAffected === 1) return { status: "requested", id };
    const generations = await SearchIndexGenerations.forEnvironment(
      database,
      params.environment,
    );
    return generations.status === "foreign"
      ? generations
      : { status: "in_flight" };
  },

  /** requested -> loading, recording the temp index and the snapshot. */
  async startLoading(
    database: LibSQLDatabase,
    params: {
      id: string;
      tempIndexName: string;
      snapshotChangeId: number;
      now: Date;
    },
  ): Promise<boolean> {
    const updated = await database
      .update(searchIndexGeneration)
      .set({
        status: "loading",
        tempIndexName: params.tempIndexName,
        snapshotChangeId: params.snapshotChangeId,
        vinCursor: null,
        recordsLoaded: 0,
        startedAt: params.now,
        updatedAt: params.now,
      })
      .where(
        and(
          eq(searchIndexGeneration.id, params.id),
          eq(searchIndexGeneration.status, "requested"),
        ),
      );
    return updated.rowsAffected === 1;
  },

  /**
   * Records a loaded batch: the VIN cursor moves from `from` to `to`, and the
   * generation moves on to `moving` once the last batch is loaded.
   */
  async recordLoad(
    database: LibSQLDatabase,
    params: {
      id: string;
      from: string | null;
      to: string | null;
      records: number;
      done: boolean;
      now: Date;
    },
  ): Promise<boolean> {
    const updated = await database
      .update(searchIndexGeneration)
      .set({
        status: params.done ? "moving" : "loading",
        vinCursor: params.to,
        recordsLoaded: sql`${searchIndexGeneration.recordsLoaded} + ${params.records}`,
        updatedAt: params.now,
      })
      .where(
        and(
          eq(searchIndexGeneration.id, params.id),
          eq(searchIndexGeneration.status, "loading"),
          params.from === null
            ? isNull(searchIndexGeneration.vinCursor)
            : eq(searchIndexGeneration.vinCursor, params.from),
        ),
      );
    return updated.rowsAffected === 1;
  },

  /** Records the move task before waiting on it. */
  async recordMoveTask(
    database: LibSQLDatabase,
    params: { id: string; taskId: number; now: Date },
  ): Promise<boolean> {
    const updated = await database
      .update(searchIndexGeneration)
      .set({ moveTaskId: params.taskId, updatedAt: params.now })
      .where(
        and(
          eq(searchIndexGeneration.id, params.id),
          eq(searchIndexGeneration.status, "moving"),
          isNull(searchIndexGeneration.moveTaskId),
        ),
      );
    return updated.rowsAffected === 1;
  },

  /**
   * Makes a moved generation live and supersedes the previous live one. The
   * move removed the temporary index, so it needs no cleanup. Run in one
   * transaction with the projector's cursor jump.
   */
  goLiveStatements(params: {
    id: string;
    environment: string;
    now: Date;
  }): InStatement[] {
    const now = params.now.getTime();
    return [
      {
        sql: `
          update search_index_generation
          set status = 'superseded', ended_at = ?, updated_at = ?
          where environment = ? and status = 'live'
            and exists (
              select 1 from search_index_generation moved
              where moved.id = ? and moved.status = 'moving'
            )
        `,
        args: [now, now, params.environment, params.id],
      },
      {
        sql: `
          update search_index_generation
          set status = 'live', live_at = ?, temp_index_deleted_at = ?,
              updated_at = ?
          where id = ? and status = 'moving'
        `,
        args: [now, now, now, params.id],
      },
    ];
  },

  /**
   * Ends a generation that can no longer go live, and requests a new one for
   * the same reason so the rebuild is retried from the start. Its temporary
   * index is deleted by the next sweep.
   */
  discardStatements(params: {
    generation: ActiveSearchIndexGeneration;
    error: string;
    now: Date;
  }): InStatement[] {
    const now = params.now.getTime();
    const { generation } = params;
    return [
      {
        sql: `
          update search_index_generation
          set status = 'discarded', ended_at = ?, last_error = ?, updated_at = ?
          where id = ? and status in ('requested', 'loading')
        `,
        args: [now, params.error, now, generation.id],
      },
      {
        sql: `
          insert into search_index_generation (
            id, environment, index_name, status, reason, requested_at,
            updated_at
          )
          select ?, ?, ?, 'requested', ?, ?, ?
          where exists (
            select 1 from search_index_generation
            where id = ? and status = 'discarded'
          )
          on conflict do nothing
        `,
        args: [
          crypto.randomUUID(),
          generation.environment,
          generation.indexName,
          generation.reason,
          now,
          now,
          generation.id,
        ],
      },
    ];
  },

  /** Ended generations of an environment whose temporary index may remain. */
  async endedWithTempIndex(
    database: LibSQLDatabase,
    environment: string,
  ): Promise<Array<{ id: string; tempIndexName: string }>> {
    const rows = await database
      .select({
        id: searchIndexGeneration.id,
        tempIndexName: searchIndexGeneration.tempIndexName,
      })
      .from(searchIndexGeneration)
      .where(
        and(
          eq(searchIndexGeneration.environment, environment),
          inArray(searchIndexGeneration.status, ["superseded", "discarded"]),
          isNotNull(searchIndexGeneration.tempIndexName),
          isNull(searchIndexGeneration.tempIndexDeletedAt),
        ),
      );
    return rows.flatMap((row) =>
      row.tempIndexName === null
        ? []
        : [{ id: row.id, tempIndexName: row.tempIndexName }],
    );
  },

  async markTempIndexDeleted(
    database: LibSQLDatabase,
    params: { id: string; now: Date },
  ): Promise<void> {
    await database
      .update(searchIndexGeneration)
      .set({ tempIndexDeletedAt: params.now, updatedAt: params.now })
      .where(eq(searchIndexGeneration.id, params.id));
  },

  /** When a rebuild for `reason` was last requested in the environment. */
  async lastRequestedAt(
    database: LibSQLDatabase,
    params: { environment: string; reason: SearchIndexGenerationReason },
  ): Promise<Date | null> {
    const [row] = await database
      .select({ requestedAt: searchIndexGeneration.requestedAt })
      .from(searchIndexGeneration)
      .where(
        and(
          eq(searchIndexGeneration.environment, params.environment),
          eq(searchIndexGeneration.reason, params.reason),
        ),
      )
      .orderBy(desc(searchIndexGeneration.requestedAt))
      .limit(1);
    return row?.requestedAt ?? null;
  },
} as const;
