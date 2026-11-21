import "server-only";

import { env } from "~/env";
import { db, dbClient } from "~/lib/db";
import { getAlertMatchStatsBatch } from "./algolia-alert-search";
import { SearchAlertsFlag } from "./search-alerts-flag";
import {
  openSearchAlertCheckState,
  runSearchAlertCheckBatch,
  touchSearchAlertCheck,
  type SearchAlertCheckContext,
} from "./search-alert-check";

const context: SearchAlertCheckContext = {
  database: db,
  client: dbClient,
  appUrl: env.NEXT_PUBLIC_APP_URL,
  matchSearches: getAlertMatchStatsBatch,
  alertsEnabled: async () => (await SearchAlertsFlag.mode()) === "enabled",
};

/** Whether saved-search alerts are switched on (fails closed). */
export async function searchAlertsEnabled(): Promise<boolean> {
  return context.alertsEnabled();
}

export function runDailySearchAlertCheckBatch(day: string) {
  return runSearchAlertCheckBatch(context, day, new Date());
}

/** Marks the day's running check live while a batch waits for the search writer. */
export function touchDailySearchAlertCheck(day: string) {
  return touchSearchAlertCheck(db, day, new Date());
}

export function openDailySearchAlertCheck(day: string) {
  return openSearchAlertCheckState(context, day, new Date());
}
