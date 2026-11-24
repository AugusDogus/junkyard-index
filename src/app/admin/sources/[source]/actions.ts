"use server";

import { updateTag } from "next/cache";
import { db } from "~/lib/db";
import { requireAdmin } from "~/server/admin/require-admin";
import { startManualIngestionRun } from "~/server/ingestion/manual-ingestion-run-runtime";
import {
  getHiddenSources,
  SOURCE_CONTROL_CACHE_TAG,
} from "~/server/source-control/hidden-sources-loader";
import { HiddenSources } from "~/lib/hidden-source";
import { loadHiddenSources } from "~/server/source-control/hidden-sources";
import { IngestionPause } from "~/server/source-control/ingestion-pause";
import {
  SourceControlAction,
  type SourceControlResult,
} from "~/server/source-control/source-control-action";
import { SourceControlRepository } from "~/server/source-control/source-control-repository";

/**
 * Pause, resume, hide, show or run one source from its admin page. Anyone
 * who is not an admin gets the site's 404 before the input is read.
 */
export async function applySourceControl(
  input: unknown,
): Promise<SourceControlResult> {
  const { userId } = await requireAdmin();
  return SourceControlAction.perform(
    {
      apply: (change) => SourceControlRepository.apply(db, change),
      pauseCause: IngestionPause.cause,
      startRun: (source) => startManualIngestionRun(source, "admin"),
      logRun: (entry) => SourceControlRepository.logRun(db, entry),
      expireHiddenSources: () => updateTag(SOURCE_CONTROL_CACHE_TAG),
      prewarmHiddenSources: async () => {
        await getHiddenSources();
      },
      // Read after the show is saved, so only the stale rule can still
      // hide the source.
      staleHidden: async (source) =>
        HiddenSources.has(await loadHiddenSources(db, new Date()), source),
    },
    userId,
    input,
    new Date(),
  );
}
