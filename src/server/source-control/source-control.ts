import {
  INGESTION_SOURCES,
  isIngestionSource,
  type IngestionSource,
} from "~/lib/ingestion-source";
import type { IngestionFlag } from "~/server/admin/source-overview";

/** Whether new ingestion runs may include the source, as the owner set it. */
export type SourceIngestion = "running" | "paused";

/** Whether the public site shows the source; a hidden one says why. */
export type SourceVisibility =
  | { status: "shown" }
  | { status: "hidden"; reason: string };

/**
 * The owner's controls for one source, from the `source_control` table. A
 * source without a row runs and is shown (`lastChange` null).
 */
export type SourceControl = {
  source: IngestionSource;
  ingestion: SourceIngestion;
  visibility: SourceVisibility;
  /** Who last changed the row and when; byUserId null for a migration. */
  lastChange: { at: Date; byUserId: string | null } | null;
};

/** A `source_control` row as Drizzle reads it. */
export type SourceControlRow = {
  source: string;
  ingestion: SourceIngestion;
  visibility: "shown" | "hidden";
  hiddenReason: string | null;
  updatedByUserId: string | null;
  updatedAt: Date;
};

/** What the owner can change from /admin. */
export type SourceControlChange =
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "hide"; reason: string }
  | { kind: "show" };

export type SourceControlApplied = {
  status: "changed" | "unchanged";
  control: SourceControl;
};

/**
 * Why a source's ingestion is paused: the owner paused it here, its
 * `ingestion-source-<source>` Vercel flag serves false, or both. A flag that
 * could not be read ("unknown") pauses nothing, as at runtime.
 */
export type PauseCause = "admin" | "flag" | "admin_and_flag";

function initial(source: IngestionSource): SourceControl {
  return {
    source,
    ingestion: "running",
    visibility: { status: "shown" },
    lastChange: null,
  };
}

function fromRow(
  row: SourceControlRow & { source: IngestionSource },
): SourceControl {
  const reason = row.hiddenReason?.trim() ?? "";
  if (row.visibility === "hidden" && reason === "") {
    throw new Error(
      `The source_control row for "${row.source}" is hidden without a reason, which its check constraint forbids. Nothing was changed. Set hidden_reason for that row, or show the source again from /admin.`,
    );
  }
  return {
    source: row.source,
    ingestion: row.ingestion,
    visibility:
      row.visibility === "hidden"
        ? { status: "hidden", reason }
        : { status: "shown" },
    lastChange: { at: row.updatedAt, byUserId: row.updatedByUserId },
  };
}

function sameVisibility(a: SourceVisibility, b: SourceVisibility): boolean {
  return a.status === "hidden" && b.status === "hidden"
    ? a.reason === b.reason
    : a.status === b.status;
}

export const SourceControl = {
  initial,

  /** Stored rows by source, in registry order; unknown sources are skipped. */
  fromRows(
    rows: readonly SourceControlRow[],
  ): Map<IngestionSource, SourceControl> {
    const bySource = new Map<string, SourceControlRow>(
      rows.map((row) => [row.source, row]),
    );
    const controls = new Map<IngestionSource, SourceControl>();
    for (const source of INGESTION_SOURCES) {
      const row = bySource.get(source);
      if (row !== undefined) controls.set(source, fromRow({ ...row, source }));
    }
    return controls;
  },

  /** The control for `source`, or its default when it has no row. */
  of(
    controls: ReadonlyMap<IngestionSource, SourceControl>,
    source: IngestionSource,
  ): SourceControl {
    return controls.get(source) ?? initial(source);
  },

  apply(
    control: SourceControl,
    change: SourceControlChange,
  ): SourceControlApplied {
    const next: SourceControl =
      change.kind === "pause" || change.kind === "resume"
        ? {
            ...control,
            ingestion: change.kind === "pause" ? "paused" : "running",
          }
        : {
            ...control,
            visibility:
              change.kind === "hide"
                ? { status: "hidden", reason: change.reason }
                : { status: "shown" },
          };
    const unchanged =
      next.ingestion === control.ingestion &&
      sameVisibility(next.visibility, control.visibility);
    return unchanged
      ? { status: "unchanged", control }
      : { status: "changed", control: next };
  },

  pauseCause(
    ingestion: SourceIngestion,
    flag: IngestionFlag,
  ): PauseCause | null {
    const byAdmin = ingestion === "paused";
    const byFlag = flag === "off";
    if (byAdmin && byFlag) return "admin_and_flag";
    if (byAdmin) return "admin";
    if (byFlag) return "flag";
    return null;
  },

  /** The flag-enabled sources the owner has not paused, in their order. */
  runnable<Source extends string>(
    flagEnabled: readonly Source[],
    controls: ReadonlyMap<IngestionSource, SourceControl>,
  ): Source[] {
    return flagEnabled.filter(
      (source) =>
        !isIngestionSource(source) ||
        controls.get(source)?.ingestion !== "paused",
    );
  },
} as const;
