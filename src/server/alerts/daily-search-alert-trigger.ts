import { IngestionDay } from "~/server/ingestion/ingestion-day";
import type { SearchAlertCheckBatchResult } from "./search-alert-check";

// 18:00 UTC. Passes usually finish by 16:00 UTC, including a failing
// source's third attempt; the deadline keeps a stuck source from holding
// back everyone's alerts.
const ALERT_CHECK_DEADLINE_MS = 11 * 60 * 60 * 1000;

export interface DailySearchAlertsTriggered {
  check: boolean;
  delivery: boolean;
}

/**
 * Starts the day's saved-search alert check while it is pending, and
 * delivery whenever a notification can go out. Delivery is independent of
 * the check: intents still owned by a running check are held back by the
 * delivery claim, while retries, daily-limit holdovers and earlier checks'
 * intents must not wait for a check that keeps failing. A past day starts
 * no check; the current day's check covers its vehicles. Callers pass the
 * lookups and workflow starts, so this stays out of the workflow bundle's
 * runtime imports.
 */
export async function startDailySearchAlerts(
  day: string,
  operations: {
    now: Date;
    isCheckPending(day: string): Promise<boolean>;
    hasDeliverableIntents(): Promise<boolean>;
    startCheck(day: string): Promise<unknown>;
    startDelivery(): Promise<unknown>;
  },
): Promise<DailySearchAlertsTriggered> {
  const check =
    IngestionDay.key(operations.now) === day &&
    (await operations.isCheckPending(day));
  if (check) await operations.startCheck(day);
  const delivery = await operations.hasDeliverableIntents();
  if (delivery) await operations.startDelivery();
  return { check, delivery };
}

/** Whether the day's alert deadline has passed, so the cron starts the check. */
export function isPastSearchAlertDeadline(now: Date): boolean {
  return (
    now.getTime() >= IngestionDay.start(now).getTime() + ALERT_CHECK_DEADLINE_MS
  );
}

export type SearchAlertCheckRunResult =
  | { status: "not_started" | "stopped" }
  | { status: "completed"; searchesProcessed: number; intentsCreated: number };

/**
 * Drains one day's check: retries after a delay while a batch could read
 * incomplete results, then starts delivery. A check that was superseded or
 * never started also delivers, since earlier intents may be waiting.
 */
export async function runSearchAlertCheck(operations: {
  runBatch(): Promise<SearchAlertCheckBatchResult>;
  waitForRetry(): Promise<void>;
  startDelivery(): Promise<void>;
}): Promise<SearchAlertCheckRunResult> {
  // Invoke step callbacks without serializing the operations object as `this`.
  const { runBatch, waitForRetry, startDelivery } = operations;
  let searchesProcessed = 0;
  let intentsCreated = 0;
  while (true) {
    const batch = await runBatch();
    if (batch.status === "waiting") {
      await waitForRetry();
      continue;
    }
    if (batch.status === "not_started" || batch.status === "stopped") {
      await startDelivery();
      return { status: batch.status };
    }
    searchesProcessed += batch.searchesProcessed;
    intentsCreated += batch.intentsCreated;
    if (batch.status === "complete") {
      await startDelivery();
      return { status: "completed", searchesProcessed, intentsCreated };
    }
  }
}
