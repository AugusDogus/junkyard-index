import { db } from "~/lib/db";
import type { IngestionSource } from "~/lib/ingestion-source";
import { IngestionSourceFlags } from "~/server/ingestion/ingestion-source-flags";
import { SourceControl, type PauseCause } from "./source-control";
import { SourceControlRepository } from "./source-control-repository";

/**
 * Whether ingestion may run a source. A source is paused when the owner
 * paused it from /admin (`source_control`) or its
 * `ingestion-source-<source>` Vercel flag serves false. The flag fails open
 * (a missing flag or failed evaluation keeps the source on); the database
 * read does not, so a failed read stops the pass rather than running a
 * source the owner paused.
 */
export const IngestionPause = {
  /** Active sources neither the owner nor their flag paused. */
  async enabledSources(): Promise<IngestionSource[]> {
    const [flagged, controls] = await Promise.all([
      IngestionSourceFlags.enabledSources(),
      SourceControlRepository.all(db),
    ]);
    return SourceControl.runnable(flagged, controls);
  },

  /** Why the source is paused, or null while it may run. */
  async cause(source: IngestionSource): Promise<PauseCause | null> {
    const [flagged, control] = await Promise.all([
      IngestionSourceFlags.enabledSources(),
      SourceControlRepository.forSource(db, source),
    ]);
    return SourceControl.pauseCause(
      control.ingestion,
      flagged.includes(source) ? "on" : "off",
    );
  },
} as const;
