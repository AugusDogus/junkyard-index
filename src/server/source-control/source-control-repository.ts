import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { z } from "zod";
import { HiddenSources } from "~/lib/hidden-source";
import type { IngestionSource } from "~/lib/ingestion-source";
import { adminActionLog, sourceControl, user } from "~/schema";
import {
  SourceControl,
  type SourceControlApplied,
  type SourceControlChange,
} from "./source-control";

export const ADMIN_ACTIONS = [
  "pause_ingestion",
  "resume_ingestion",
  "hide_source",
  "show_source",
  "run_now",
] as const;

/** What an admin did, as `admin_action_log.action` stores it. */
export type AdminActionKind = (typeof ADMIN_ACTIONS)[number];

const actionSchema = z.enum(ADMIN_ACTIONS);

export type AdminActionEntry = {
  id: number;
  action: AdminActionKind;
  source: string | null;
  userId: string;
  /** The admin's name, else email; null once their account is removed. */
  userName: string | null;
  /** The hide reason, or the run ids of a manual run. */
  detail: string | null;
  createdAt: Date;
};

const ACTION_OF_CHANGE = {
  pause: "pause_ingestion",
  resume: "resume_ingestion",
  hide: "hide_source",
  show: "show_source",
} as const satisfies Record<SourceControlChange["kind"], AdminActionKind>;

async function all(
  database: LibSQLDatabase,
): Promise<Map<IngestionSource, SourceControl>> {
  return SourceControl.fromRows(await database.select().from(sourceControl));
}

async function forSource(
  database: LibSQLDatabase,
  source: IngestionSource,
): Promise<SourceControl> {
  const rows = await database
    .select()
    .from(sourceControl)
    .where(eq(sourceControl.source, source));
  return SourceControl.of(SourceControl.fromRows(rows), source);
}

/**
 * The write for one change. It sets only the columns the change owns, and
 * only when they differ from what is stored, so it changes no row when the
 * control already matches. Resume and show never add a row: a source without
 * one already runs and is shown.
 */
function changeWrite(
  database: LibSQLDatabase,
  input: {
    source: IngestionSource;
    change: SourceControlChange;
    userId: string;
    now: Date;
  },
) {
  const { source, change } = input;
  const stamp = { updatedByUserId: input.userId, updatedAt: input.now };
  switch (change.kind) {
    case "pause":
      return database
        .insert(sourceControl)
        .values({ source, ingestion: "paused", ...stamp })
        .onConflictDoUpdate({
          target: sourceControl.source,
          set: { ingestion: "paused", ...stamp },
          setWhere: ne(sourceControl.ingestion, "paused"),
        });
    case "hide":
      return database
        .insert(sourceControl)
        .values({
          source,
          visibility: "hidden",
          hiddenReason: change.reason,
          ...stamp,
        })
        .onConflictDoUpdate({
          target: sourceControl.source,
          set: { visibility: "hidden", hiddenReason: change.reason, ...stamp },
          setWhere: sql`${sourceControl.visibility} != 'hidden' or ${sourceControl.hiddenReason} is not ${change.reason}`,
        });
    case "resume":
      return database
        .update(sourceControl)
        .set({ ingestion: "running", ...stamp })
        .where(
          and(
            eq(sourceControl.source, source),
            ne(sourceControl.ingestion, "running"),
          ),
        );
    case "show":
      return database
        .update(sourceControl)
        .set({ visibility: "shown", hiddenReason: null, ...stamp })
        .where(
          and(
            eq(sourceControl.source, source),
            ne(sourceControl.visibility, "shown"),
          ),
        );
  }
}

/**
 * Reads and writes of the owner's per-source controls and the admin action
 * log. The control table has a row per changed source (a few dozen at most),
 * so reading all of it is cheap.
 */
export const SourceControlRepository = {
  all,
  forSource,

  /** The sources hidden from the public site now, read without a cache. */
  async hiddenSources(database: LibSQLDatabase): Promise<HiddenSources> {
    const rows = await database
      .select({ source: sourceControl.source })
      .from(sourceControl)
      .where(eq(sourceControl.visibility, "hidden"));
    return HiddenSources.of(rows.map((row) => row.source));
  },

  /** The sources the owner paused from /admin. */
  async pausedSources(database: LibSQLDatabase): Promise<Set<IngestionSource>> {
    const controls = await all(database);
    return new Set(
      [...controls.values()]
        .filter((control) => control.ingestion === "paused")
        .map((control) => control.source),
    );
  },

  /**
   * Applies one change and logs it in the same batch. The write touches only
   * the columns the change owns and only when they differ, so overlapping
   * changes (a hide and a pause from two tabs) both survive, and an unchanged
   * control (pausing a paused source) writes and logs nothing.
   */
  async apply(
    database: LibSQLDatabase,
    input: {
      source: IngestionSource;
      change: SourceControlChange;
      userId: string;
      now: Date;
    },
  ): Promise<SourceControlApplied> {
    const { source, change, userId, now } = input;
    const action = ACTION_OF_CHANGE[change.kind];
    const detail = change.kind === "hide" ? change.reason : null;
    const [, logged] = await database.batch([
      changeWrite(database, input),
      // changes() counts the rows the write above changed, so the log entry
      // lands only when the control did change.
      database.run(sql`
        insert into admin_action_log (user_id, action, source, detail, created_at)
        select ${userId}, ${action}, ${source}, ${detail}, ${now.getTime()}
        where changes() > 0
      `),
    ]);
    return {
      status: logged.rowsAffected > 0 ? "changed" : "unchanged",
      control: await forSource(database, source),
    };
  },

  async logRun(
    database: LibSQLDatabase,
    input: {
      source: IngestionSource;
      userId: string;
      runId: string;
      workflowRunId: string;
      now: Date;
    },
  ): Promise<void> {
    await database.insert(adminActionLog).values({
      userId: input.userId,
      action: "run_now",
      source: input.source,
      detail: `Run ${input.runId}, workflow ${input.workflowRunId}`,
      createdAt: input.now,
    });
  },

  /** The source's newest logged actions, newest first. */
  async recentActions(
    database: LibSQLDatabase,
    source: IngestionSource,
    limit: number,
  ): Promise<AdminActionEntry[]> {
    const rows = await database
      .select({
        id: adminActionLog.id,
        action: adminActionLog.action,
        source: adminActionLog.source,
        userId: adminActionLog.userId,
        userName: sql<
          string | null
        >`coalesce(nullif(trim(${user.name}), ''), ${user.email})`,
        detail: adminActionLog.detail,
        createdAt: adminActionLog.createdAt,
      })
      .from(adminActionLog)
      .leftJoin(user, eq(user.id, adminActionLog.userId))
      .where(eq(adminActionLog.source, source))
      .orderBy(desc(adminActionLog.createdAt), desc(adminActionLog.id))
      .limit(limit);
    return rows.map((row) => {
      const action = actionSchema.safeParse(row.action);
      if (!action.success) {
        throw new Error(
          `admin_action_log row ${row.id} has action "${row.action}", which this deployment does not know. Nothing was changed. A newer deployment may have written it; deploy the latest main.`,
        );
      }
      return { ...row, action: action.data };
    });
  },
} as const;
