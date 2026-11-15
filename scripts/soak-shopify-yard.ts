import type { ConnectorChunkResult } from "../src/server/ingestion/connector-chunk";
import type { IngestionSource } from "../src/lib/ingestion-source";

/** Preserve paused checkpoints at a caller's GET cap; never count partial inventory. */
export async function soakShopifyYard<
  S extends IngestionSource,
  C extends { source: S; phase: string; checksum: string },
>(
  initial: C,
  runChunk: (
    cursor: C,
    maxPages: number,
  ) => Promise<ConnectorChunkResult<S, C>>,
  maxRequests = 4,
): Promise<ConnectorChunkResult<S, C>> {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1)
    throw new Error("Shopify yard soak requires a positive GET budget");
  let cursor = initial;
  let pagesProcessed = 0;
  while (pagesProcessed < maxRequests) {
    const budget = Math.min(4, maxRequests - pagesProcessed);
    const chunk = await runChunk(cursor, budget);
    if (
      chunk.source !== initial.source ||
      !Number.isSafeInteger(chunk.pagesProcessed) ||
      chunk.pagesProcessed < 1 ||
      chunk.pagesProcessed > budget ||
      chunk.cursor.checksum === cursor.checksum ||
      (chunk.status === "complete") !== (chunk.cursor.phase === "complete") ||
      (chunk.status === "paused" &&
        (chunk.count !== 0 ||
          chunk.accounting?.recordsProcessed !== 0 ||
          chunk.observedVins?.length !== 0))
    )
      throw new Error(
        "Shopify yard soak made no validated progress; retain the prior checkpoint",
      );
    cursor = chunk.cursor;
    pagesProcessed += chunk.pagesProcessed;
    if (chunk.status === "complete" || pagesProcessed === maxRequests)
      return { ...chunk, pagesProcessed };
  }
  throw new Error(
    "Shopify yard soak exhausted its GET budget without a result",
  );
}
