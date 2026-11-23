import "server-only";
import { AlgoliaDeployment } from "~/lib/algolia-deployment";
import { db } from "~/lib/db";
import type { IngestionSource } from "~/lib/ingestion-source";
import { AlertStatus } from "~/server/alerts/alert-status";
import { DELIVERY_LEASE_MS } from "~/server/alerts/durable-alert-delivery-runtime";
import {
  SearchAlertsFlag,
  type SearchAlertsMode,
} from "~/server/alerts/search-alerts-flag";
import { ConsumerFlags } from "~/server/ingestion/consumer-flags";
import { IngestionDay } from "~/server/ingestion/ingestion-day";
import { IngestionSourceFlags } from "~/server/ingestion/ingestion-source-flags";
import { PublicationModeFlag } from "~/server/ingestion/publication-mode-flag";
import { SearchStatus } from "~/server/ingestion/search-status";
import {
  AlertCheckOverview,
  type AlertCheckSummary,
} from "./alert-check-overview";
import { SearchOverview } from "./search-overview";
import { SearchRepository, type SearchPublication } from "./search-repository";
import {
  SourceOverview,
  type SourceFlagsReading,
  type SourceSummary,
} from "./source-overview";
import type { SourceRunErrors } from "./source-run";
import { SourceRunRepository } from "./source-run-repository";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Days of runs and alert checks the dashboard reads. */
export const ADMIN_WINDOW_DAYS = 14;
function windowStart(now: Date): Date {
  return new Date(now.getTime() - ADMIN_WINDOW_DAYS * DAY_MS);
}

/** Runs a source's page lists. */
export const SOURCE_PAGE_RUNS = 14;
/** Search publications the search page lists. */
export const SEARCH_PAGE_PUBLICATIONS = 20;

/**
 * One part of a page's data. A part that fails to load is shown as a plain
 * error with its raw text, and the rest of the page still renders.
 */
export type Loaded<Value> =
  | { status: "ok"; value: Value }
  | { status: "failed"; what: string; message: string };

async function load<Value>(
  what: string,
  work: () => Promise<Value>,
): Promise<Loaded<Value>> {
  try {
    return { status: "ok", value: await work() };
  } catch (error) {
    console.error(`Admin dashboard could not load ${what}`, error);
    return {
      status: "failed",
      what,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Every ingestion-source flag; a failed read pauses nothing, as at runtime. */
async function readSourceFlags(): Promise<SourceFlagsReading> {
  try {
    return {
      status: "read",
      enabled: new Set(await IngestionSourceFlags.enabledSources()),
    };
  } catch (error) {
    return {
      status: "unavailable",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export type SourcesData = {
  summaries: SourceSummary[];
  /** Error excerpts of each source's latest run, by source run id. */
  latestErrors: Map<string, SourceRunErrors>;
  lastRunStartedAt: Date | null;
  flags: SourceFlagsReading;
};

export type SearchData = {
  overview: SearchOverview;
  publications: SearchPublication[];
};

export type AlertsData = {
  mode: SearchAlertsMode;
  status: AlertStatus;
  checks: AlertCheckSummary[];
};

export type SourceDetailData = {
  summary: SourceSummary;
  runs: Awaited<ReturnType<typeof SourceRunRepository.forSource>>;
};

async function loadSources(now: Date): Promise<SourcesData> {
  const [runs, activeRuns, publishedCounts, flags] = await Promise.all([
    SourceRunRepository.recent(db, windowStart(now)),
    SourceRunRepository.activeRuns(db),
    SourceRunRepository.publishedCounts(db),
    readSourceFlags(),
  ]);
  const summaries = SourceOverview.build({
    now,
    runs,
    activeRuns,
    publishedCounts,
    flags,
  });
  const latestErrors = await SourceRunRepository.errorExcerpts(
    db,
    summaries.flatMap((summary) =>
      summary.latestRun === null ? [] : [summary.latestRun.run.id],
    ),
  );
  return {
    summaries,
    latestErrors,
    lastRunStartedAt: SourceOverview.lastRunStartedAt(runs),
    flags,
  };
}

async function loadSearch(now: Date): Promise<SearchData> {
  const [mode, projector] = await Promise.all([
    PublicationModeFlag.mode(),
    ConsumerFlags.mode("search-projector"),
  ]);
  const [inputs, publications, unprocessed, fullReindexRequired] =
    await Promise.all([
      SearchStatus.load(db, {
        mode,
        consumer: projector,
        environment: AlgoliaDeployment.parse(process.env.VERCEL_ENV),
        now,
      }),
      SearchRepository.recentPublications(db, SEARCH_PAGE_PUBLICATIONS),
      SearchRepository.unprocessedChanges(db),
      SearchRepository.fullReindexRequired(db),
    ]);
  return {
    overview: SearchOverview.build({
      now,
      status: SearchStatus.evaluate(inputs, now),
      projector,
      newestSearchPublishedAt: publications[0]?.searchPublishedAt ?? null,
      unprocessed,
      fullReindexRequired,
    }),
    publications,
  };
}

async function loadAlerts(now: Date): Promise<AlertsData> {
  const mode = await SearchAlertsFlag.mode();
  // Today and the 13 ingestion days before it.
  const sinceDay = IngestionDay.key(
    new Date(now.getTime() - (ADMIN_WINDOW_DAYS - 1) * DAY_MS),
  );
  const [inputs, checks] = await Promise.all([
    AlertStatus.load(db, now, mode, DELIVERY_LEASE_MS),
    AlertCheckOverview.load(db, sinceDay),
  ]);
  return { mode, status: AlertStatus.evaluate(inputs, now), checks };
}

async function loadSource(
  source: IngestionSource,
  now: Date,
): Promise<SourceDetailData> {
  // The summary reads the same window as the sources list, so both pages
  // agree; the run list shows the newest runs whatever their age.
  const [windowRuns, runs, activeRuns, publishedCounts, flags] =
    await Promise.all([
      SourceRunRepository.recentForSource(db, source, windowStart(now)),
      SourceRunRepository.forSource(db, source, SOURCE_PAGE_RUNS),
      SourceRunRepository.activeRuns(db),
      SourceRunRepository.publishedCounts(db),
      readSourceFlags(),
    ]);
  const summary = SourceOverview.build({
    now,
    runs: windowRuns,
    activeRuns,
    publishedCounts,
    flags,
  }).find((entry) => entry.source === source);
  if (summary === undefined) {
    throw new Error(
      `SourceOverview.build returned no summary for ingestion source "${source}", which INGESTION_SOURCES lists. This is a bug in src/server/admin/source-overview.ts.`,
    );
  }
  return { summary, runs };
}

/**
 * The admin pages' reads. Each is bounded (time window, id list or limit),
 * none scans the vehicle table, and none searches Algolia. Callers must have
 * passed requireAdmin first.
 */
export const AdminData = {
  sources: (now: Date) => load("source runs", () => loadSources(now)),
  search: (now: Date) => load("search status", () => loadSearch(now)),
  alerts: (now: Date) => load("saved-search alerts", () => loadAlerts(now)),
  source: (source: IngestionSource, now: Date) =>
    load("this source's runs", () => loadSource(source, now)),
} as const;
