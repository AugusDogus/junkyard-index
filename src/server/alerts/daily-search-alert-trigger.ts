import { IngestionDay } from "~/server/ingestion/ingestion-day";
import type {
  SearchAlertCheckBatchResult,
  SearchAlertCheckState,
} from "./search-alert-check";
import { SearchAlertSchedule } from "./search-alert-schedule";

export type DailySearchAlertsTriggered =
  | { status: "alerts_disabled" }
  | { status: "triggered"; check: boolean; delivery: boolean };

/**
 * Starts the day's saved-search alert check while it is pending, and
 * delivery when a notification can go out. The check delivers when it
 * finishes; starting delivery here as well keeps retries and earlier
 * intents moving when today's check keeps failing. The delivery claim
 * decides what may go out: it holds recipients' earlier intents until
 * today's check finishes, so they share today's digest. The check's row is
 * opened before delivery is considered, so the hold is in place even when
 * the check workflow has not started yet. A past day starts no check; the
 * current day's check covers its vehicles. Callers pass the lookups and
 * workflow starts, so this stays out of the workflow bundle's runtime
 * imports.
 */
export async function startDailySearchAlerts(
  day: string,
  operations: {
    now: Date;
    /** Whether saved-search alerts are switched on (fails closed). */
    alertsEnabled(): Promise<boolean>;
    /** Opens (creating while current) the day's check and returns its state. */
    openCheck(day: string): Promise<SearchAlertCheckState>;
    hasDeliverableIntents(): Promise<boolean>;
    startCheck(day: string): Promise<unknown>;
    startDelivery(): Promise<unknown>;
  },
): Promise<DailySearchAlertsTriggered> {
  // Paused alerts open no check (so no bound or hold) and start nothing.
  if (!(await operations.alertsEnabled())) return { status: "alerts_disabled" };
  const state =
    IngestionDay.key(operations.now) === day
      ? await operations.openCheck(day)
      : "finished";
  const check = state === "running";
  if (check) await operations.startCheck(day);
  const delivery = await operations.hasDeliverableIntents();
  if (delivery) await operations.startDelivery();
  return { status: "triggered", check, delivery };
}

/** Whether the day's alert deadline has passed, so the cron starts the check. */
export function isPastSearchAlertDeadline(now: Date): boolean {
  return SearchAlertSchedule.isPastDeadline(now);
}

export type SearchAlertCheckRunResult =
  | { status: "not_started" | "stopped" | "alerts_disabled" }
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
    // Paused mid-check: stop without delivering; the check resumes from its
    // cursor once alerts are switched back on.
    if (batch.status === "alerts_disabled") return { status: batch.status };
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
