"use server";

import { updateTag } from "next/cache";
import { db } from "~/lib/db";
import { requireAdmin } from "~/server/admin/require-admin";
import { startManualIngestionRun } from "~/server/ingestion/manual-ingestion-run-runtime";
import {
  getHiddenSources,
  SOURCE_CONTROL_CACHE_TAG,
} from "~/server/source-control/hidden-sources-loader";
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
    },
    userId,
    input,
    new Date(),
  );
}
