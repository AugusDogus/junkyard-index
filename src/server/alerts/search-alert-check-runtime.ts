import "server-only";

import { env } from "~/env";
import { db, dbClient } from "~/lib/db";
import { getAlertMatchStatsBatch } from "./algolia-alert-search";
import {
  openSearchAlertCheckState,
  runSearchAlertCheckBatch,
  type SearchAlertCheckContext,
} from "./search-alert-check";

const context: SearchAlertCheckContext = {
  database: db,
  client: dbClient,
  appUrl: env.NEXT_PUBLIC_APP_URL,
  matchSearches: getAlertMatchStatsBatch,
};

export function runDailySearchAlertCheckBatch(day: string) {
  return runSearchAlertCheckBatch(context, day, new Date());
}

export function openDailySearchAlertCheck(day: string) {
  return openSearchAlertCheckState(context, day, new Date());
}
