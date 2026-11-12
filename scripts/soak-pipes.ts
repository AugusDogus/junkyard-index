import {
  PipesCursor,
  PIPES_MAX_RUN_REQUESTS,
} from "../src/server/ingestion/pipes-cursor";
import type { PipesStreamResult } from "../src/server/ingestion/pipes-connector";

/** Read-only driver. The caller owns staging and the provider request gate. */
export async function soakPipesInventory(
  runChunk: (
    cursor: PipesCursor,
    maxPages: number,
  ) => Promise<PipesStreamResult>,
  maxPages = PIPES_MAX_RUN_REQUESTS,
): Promise<PipesStreamResult> {
  if (
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > PIPES_MAX_RUN_REQUESTS
  )
    throw new Error(
      "Pipes soak requires a finite HTTP-control budget from 1 to 512",
    );
  const summary: PipesStreamResult = {
    source: "pipes",
    status: "paused",
    cursor: PipesCursor.initial,
    count: 0,
    errors: [],
    warnings: [],
    observedVins: [],
    pagesProcessed: 0,
    accounting: {
      recordsProcessed: 0,
      recordsRejected: 0,
      recordsExcluded: 0,
      duplicateVehicles: 0,
    },
  };
  while (summary.pagesProcessed < maxPages) {
    const remaining = Math.min(8, maxPages - summary.pagesProcessed);
    const chunk = await runChunk(summary.cursor, remaining);
    if (chunk.status === "failed") return chunk;
    const cursor = PipesCursor.parse(PipesCursor.serialize(chunk.cursor));
    if (
      !Number.isSafeInteger(chunk.pagesProcessed) ||
      chunk.pagesProcessed < 0 ||
      chunk.pagesProcessed > remaining
    )
      throw new Error(
        "Pipes soak returned an invalid HTTP-control count; retain the last validated checkpoint",
      );
    if ((chunk.status === "complete") !== (cursor.phase === "complete"))
      throw new Error(
        "Pipes soak status disagrees with terminal proof; retain the last validated checkpoint",
      );
    if (
      chunk.status === "paused" &&
      (chunk.pagesProcessed === 0 ||
        PipesCursor.serialize(cursor) ===
          PipesCursor.serialize(summary.cursor) ||
        chunk.count !== 0 ||
        (chunk.observedVins?.length ?? 0) !== 0 ||
        !chunk.accounting ||
        Object.values(chunk.accounting).some((value) => value !== 0))
    )
      throw new Error(
        "Pipes paused chunk made no validated progress or emitted premature donor accounting; retain the last checkpoint",
      );
    summary.pagesProcessed += chunk.pagesProcessed;
    summary.cursor = cursor;
    summary.status = chunk.status;
    summary.errors.push(...chunk.errors);
    summary.warnings = [
      ...new Set([...(summary.warnings ?? []), ...(chunk.warnings ?? [])]),
    ];
    if (chunk.status === "complete")
      return {
        ...chunk,
        pagesProcessed: summary.pagesProcessed,
        errors: summary.errors,
        warnings: summary.warnings,
      };
  }
  return summary;
}
