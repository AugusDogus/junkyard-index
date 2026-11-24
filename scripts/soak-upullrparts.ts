import { createClient } from "@libsql/client/web";
import { drizzle } from "drizzle-orm/libsql/web";
import type { ConnectorChunkAccounting } from "../src/server/ingestion/connector-chunk";
import { UpullRPartsHistory } from "../src/server/ingestion/upullrparts-history";
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

let soakHistory: Promise<UpullRPartsHistory> | null = null;

/**
 * The published snapshot the soak plans its windows from, read once with
 * SELECTs from the database at UPULLRPARTS_HISTORY_DATABASE_URL (with
 * UPULLRPARTS_HISTORY_AUTH_TOKEN), such as production's. Without it the soak
 * plans with no snapshot and finds its windows by halving, which costs more
 * searches.
 */
export function upullRPartsSoakHistory(): Promise<UpullRPartsHistory> {
  soakHistory ??= (async () => {
    const url = process.env.UPULLRPARTS_HISTORY_DATABASE_URL;
    if (!url) {
      console.log(
        "[upullrparts] UPULLRPARTS_HISTORY_DATABASE_URL is unset, so windows are planned without a snapshot",
      );
      return UpullRPartsHistory.empty;
    }
    const client = createClient({
      url,
      authToken: process.env.UPULLRPARTS_HISTORY_AUTH_TOKEN,
    });
    try {
      return await UpullRPartsHistory.load(drizzle(client));
    } finally {
      client.close();
    }
  })();
  return soakHistory;
}

/**
 * Read-only traversal of every chunk, round-tripping each cursor through its
 * durable wire form. A chunk's `checkpointState` (the run's make directory)
 * is kept in memory under a path its cursor names, as the repository stores
 * it with the checkpoint. A chunk deferred for the browser session waits and
 * retries the same cursor, as the workflow does. `start` resumes a crawl from
 * a checkpoint; `states` holds the state its path names.
 */
export async function soakUpullRPartsInventory(
  runChunk: (
    cursor: UpullRPartsCursor,
    loadState: (path: string) => Promise<unknown>,
  ) => Promise<UpullRPartsStreamResult>,
  start: UpullRPartsCursor = UpullRPartsCursor.initial,
  maxChunks = 60,
  states: Map<string, unknown> = new Map(),
): Promise<UpullRPartsStreamResult> {
  const loadState = async (path: string) => {
    if (!states.has(path)) throw new Error(`no soak state stored at ${path}`);
    return states.get(path);
  };
  let cursor: UpullRPartsCursor = start;
  let total: UpullRPartsStreamResult | null = null;
  let deferrals = 0;
  for (let chunks = 0; chunks < maxChunks; ) {
    const before: string = serializeDurableSourceCursor(cursor);
    const startedAt = Date.now();
    const chunk: UpullRPartsStreamResult | null = await runChunk(
      cursor,
      loadState,
    ).catch((error: unknown) => {
      const deferral = ProviderChunkClock.deferralOf(error);
      if (deferral === null || ++deferrals > MAX_CONSECUTIVE_DEFERRALS)
        throw error;
      console.log(`[upullrparts] deferred: ${deferral.message}`);
      return null;
    });
    if (chunk === null) {
      await new Promise((resolve) => setTimeout(resolve, DEFERRAL_WAIT_MS));
      continue;
    }
    chunks += 1;
    deferrals = 0;
    let returned = chunk.cursor;
    if (chunk.checkpointState !== undefined && returned.phase !== "complete") {
      const path = `memory:chunk-${chunks}`;
      states.set(path, chunk.checkpointState);
      if (returned.phase !== "directory")
        returned = { ...returned, statePath: path };
    }
    const wire: string = serializeDurableSourceCursor(returned);
    const next: UpullRPartsCursor = parseDurableSourceCursor(
      "upullrparts",
      wire,
    );
    // A blocked IP stays blocked for over an hour, and every retry opens a
    // billed browser session, so the soak stops instead of waiting.
    if (
      (next.phase === "crawl" || next.phase === "split") &&
      next.retryAt !== undefined
    )
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
