import type { ConnectorChunkAccounting } from "../src/server/ingestion/connector-chunk";
import {
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "../src/server/ingestion/durable-cursor";
import { ProviderChunkClock } from "../src/server/ingestion/provider-chunk-clock";
import type { UpullRPartsStreamResult } from "../src/server/ingestion/upullrparts-connector";
import { UpullRPartsCursor } from "../src/server/ingestion/upullrparts-cursor";

/** Kernel refuses a browser past the plan's concurrent limit, before one is
 * billed. The workflow stops waiting after three hours without an advance. */
const DEFERRAL_WAIT_MS = 60_000;
const MAX_CONSECUTIVE_DEFERRALS = 180;

const NO_ACCOUNTING: ConnectorChunkAccounting = {
  recordsProcessed: 0,
  recordsExcluded: 0,
  recordsRejected: 0,
  duplicateVehicles: 0,
};

function add(
  left: ConnectorChunkAccounting = NO_ACCOUNTING,
  right: ConnectorChunkAccounting = NO_ACCOUNTING,
): ConnectorChunkAccounting {
  return {
    recordsProcessed: left.recordsProcessed + right.recordsProcessed,
    recordsExcluded: left.recordsExcluded + right.recordsExcluded,
    recordsRejected: left.recordsRejected + right.recordsRejected,
    duplicateVehicles: left.duplicateVehicles + right.duplicateVehicles,
  };
}

/**
 * Read-only traversal of every chunk, round-tripping each cursor through its
 * durable wire form. A chunk deferred for the browser session waits and
 * retries the same cursor, as the workflow does. `start` resumes a crawl from
 * a checkpoint.
 */
export async function soakUpullRPartsInventory(
  runChunk: (cursor: UpullRPartsCursor) => Promise<UpullRPartsStreamResult>,
  start: UpullRPartsCursor = UpullRPartsCursor.initial,
  maxChunks = 60,
): Promise<UpullRPartsStreamResult> {
  let cursor: UpullRPartsCursor = start;
  let total: UpullRPartsStreamResult | null = null;
  let deferrals = 0;
  for (let chunks = 0; chunks < maxChunks; ) {
    const before: string = serializeDurableSourceCursor(cursor);
    const startedAt = Date.now();
    const chunk: UpullRPartsStreamResult | null = await runChunk(cursor).catch(
      (error: unknown) => {
        const deferral = ProviderChunkClock.deferralOf(error);
        if (deferral === null || ++deferrals > MAX_CONSECUTIVE_DEFERRALS)
          throw error;
        console.log(`[upullrparts] deferred: ${deferral.message}`);
        return null;
      },
    );
    if (chunk === null) {
      await new Promise((resolve) => setTimeout(resolve, DEFERRAL_WAIT_MS));
      continue;
    }
    chunks += 1;
    deferrals = 0;
    const wire: string = serializeDurableSourceCursor(chunk.cursor);
    const next: UpullRPartsCursor = parseDurableSourceCursor(
      "upullrparts",
      wire,
    );
    // A blocked IP stays blocked for over an hour, and every retry opens a
    // billed browser session, so the soak stops instead of waiting.
    if (next.phase !== "complete" && next.retryAt !== undefined)
      throw new Error(
        `U Pull R Parts soak stopped: ${chunk.warnings?.join(" ") ?? "getVehicles is blocking this IP."} Resume from ${before} after the block lifts or from another IP.`,
      );
    if (
      (chunk.status === "complete") !== (next.phase === "complete") ||
      (chunk.status === "paused" && wire === before)
    )
      throw new Error(
        `U Pull R Parts soak made no valid progress from ${before}; retain the last checkpoint and inspect the chunk`,
      );
    console.log(
      `[upullrparts] chunk ${chunks} ${Math.round((Date.now() - startedAt) / 1000)}s searches=${chunk.pagesProcessed} vehicles=${chunk.count} next=${wire}`,
    );
    const merged: UpullRPartsStreamResult = {
      ...chunk,
      count: (total?.count ?? 0) + chunk.count,
      pagesProcessed: (total?.pagesProcessed ?? 0) + chunk.pagesProcessed,
      warnings: [...(total?.warnings ?? []), ...(chunk.warnings ?? [])],
      observedVins: [
        ...(total?.observedVins ?? []),
        ...(chunk.observedVins ?? []),
      ],
      accounting: add(total?.accounting, chunk.accounting),
    };
    cursor = next;
    total = merged;
    if (chunk.status === "complete") return merged;
  }
  throw new Error(
    `U Pull R Parts soak stopped after ${maxChunks} chunks without completing`,
  );
}
