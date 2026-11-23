import { desc, eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { z } from "zod";
import { HiddenSources } from "~/lib/hidden-source";
import type { IngestionSource } from "~/lib/ingestion-source";
import { adminActionLog, sourceControl } from "~/schema";
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
   * Applies one change and logs it in the same transaction. An unchanged
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
    const applied = SourceControl.apply(
      await forSource(database, input.source),
      input.change,
    );
    if (applied.status === "unchanged") return applied;
    const { control } = applied;
    const values = {
      ingestion: control.ingestion,
      visibility: control.visibility.status,
      hiddenReason:
        control.visibility.status === "hidden"
          ? control.visibility.reason
          : null,
      updatedByUserId: input.userId,
      updatedAt: input.now,
    };
    await database.batch([
      database
        .insert(sourceControl)
        .values({ source: input.source, ...values })
        .onConflictDoUpdate({ target: sourceControl.source, set: values }),
      database.insert(adminActionLog).values({
        userId: input.userId,
        action: ACTION_OF_CHANGE[input.change.kind],
        source: input.source,
        detail: input.change.kind === "hide" ? input.change.reason : null,
        createdAt: input.now,
      }),
    ]);
    return {
      status: "changed",
      control: {
        ...control,
        lastChange: { at: input.now, byUserId: input.userId },
      },
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
      .select()
      .from(adminActionLog)
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
