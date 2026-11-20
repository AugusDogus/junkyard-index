import type { Client, InStatement } from "@libsql/client";
import { and, asc, eq, gt, lte, or, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type {
  AlertMatchBound,
  AlertMatchSearch,
} from "~/lib/alert-match-search";
import type { AlertMatchStats } from "~/lib/algolia-alert-search";
import { parseSavedSearchFilters } from "~/lib/saved-search-filters";
import {
  SearchAlertMatch,
  type SearchAlertData,
} from "~/lib/search-alert-data";
import { buildSearchUrl } from "~/lib/search-utils";
import { savedSearch, searchAlertCheck, vehicle } from "~/schema";
import { IngestionDay } from "~/server/ingestion/ingestion-day";
import {
  RUN_VEHICLE_STAMP_SQL,
  WINDOW_PUBLICATION_SEQUENCE_SQL,
  savedSearchAlertCheckpointStatement,
  searchAlertCheckBlockerQuery,
  searchAlertCheckWriteGuard,
  type SearchAlertCheckRead,
} from "./alert-search-checkpoint";

const MATCH_BATCH_SIZE = 50;
// A commit claim is stamped before its write lands. The bound trails the
// check's creation by this much so a claim stamped just before creation, but
// written after it, still falls outside the window.
const CLAIM_STAMP_MARGIN_MS = 60_000;

type SavedSearchRow = typeof savedSearch.$inferSelect;
export type SearchAlertCheckRow = typeof searchAlertCheck.$inferSelect;

export interface SearchAlertCheckContext {
  database: LibSQLDatabase;
  client: Pick<Client, "batch">;
  /** Origin for the search links in alert payloads. */
  appUrl: string;
  /** One batched Algolia scan for every search in a check batch. */
  matchSearches(
    searches: readonly AlertMatchSearch[],
    bound: AlertMatchBound,
  ): Promise<PromiseSettledResult<AlertMatchStats>[]>;
  /** Whether saved-search alerts are switched on (fails closed). */
  alertsEnabled(): Promise<boolean>;
}

/**
 * not_started: no check exists for a past day; the current day's check
 * covers its vehicles.
 * alerts_disabled: the search-alerts flag is off; nothing was done.
 * stopped: the check was superseded or another worker advanced it.
 * waiting: an ingestion run from the previous release is matching alerts,
 * or a commit inside the window was not searchable yet; retry later.
 */
export type SearchAlertCheckBatchResult =
  | { status: "not_started" }
  | { status: "alerts_disabled" }
  | { status: "stopped"; checkId: string }
  | { status: "waiting"; checkId: string }
  | {
      status: "paused" | "complete";
      checkId: string;
      searchesProcessed: number;
      intentsCreated: number;
    };

type SearchOutcome =
  | { status: "checked"; intentsCreated: number }
  | { status: "interrupted"; reason: "stopped" | "waiting" };

/**
 * Creates the day's check. Its bound is fixed here: the end of the last
 * whole second before every commit whose vehicles may be missing from the
 * search index (still in progress, or abandoned and awaiting a rebuild) and
 * before the claim margin. Every vehicle first seen through the bound is
 * searchable, so later checks start there without missing or repeating one.
 * Later claims are stamped after the bound (see CommitLease).
 *
 * Earlier unfinished checks are superseded: their written intents can be
 * delivered, and their unchecked searches kept their windows, which this
 * check covers.
 */
function createCheckStatements(day: string, now: Date): InStatement[] {
  const nowMs = now.getTime();
  return [
    {
      sql: `
        insert into search_alert_check (
          id, day, status, checked_through, search_cursor, started_at,
          last_progress_at
        )
        select ?, ?, 'running', bound.checked_through, null, ?, ?
        from (
          select (cast(min(coalesce((
            select min(${RUN_VEHICLE_STAMP_SQL("run")}) from ingestion_run run
            where run.active_slot = 1 or run.full_reindex_required = 1
          ), ?), ?) as integer) / 1000 - 1) * 1000 + 999 as checked_through
        ) bound
        where true
        on conflict(day) do nothing
      `,
      args: [
        crypto.randomUUID(),
        day,
        nowMs,
        nowMs,
        nowMs,
        nowMs - CLAIM_STAMP_MARGIN_MS,
      ],
    },
    {
      sql: `
        update search_alert_check
        set status = 'superseded', completed_at = ?, last_progress_at = ?
        where status = 'running' and day < ?
          and exists (select 1 from search_alert_check where day = ?)
      `,
      args: [nowMs, nowMs, day, day],
    },
  ];
}

async function loadCheck(
  database: LibSQLDatabase,
  day: string,
): Promise<SearchAlertCheckRow | undefined> {
  const [check] = await database
    .select()
    .from(searchAlertCheck)
    .where(eq(searchAlertCheck.day, day))
    .limit(1);
  return check;
}

/** The day's check, created on first use while that day is current. */
export async function openSearchAlertCheck(
  context: Pick<SearchAlertCheckContext, "database" | "client">,
  day: string,
  now: Date,
): Promise<SearchAlertCheckRow | null> {
  const existing = await loadCheck(context.database, day);
  if (existing) return existing;
  if (IngestionDay.key(now) !== day) return null;
  await context.client.batch(createCheckStatements(day, now), "write");
  const created = await loadCheck(context.database, day);
  if (!created) {
    throw new Error(
      `Search alert check for ${day} was not created. Saved searches and their alert windows are unchanged; retry the check.`,
    );
  }
  return created;
}

/** missing: a past day that never started. running: still matching (or failing). */
export type SearchAlertCheckState = "missing" | "running" | "finished";

/**
 * Opens the day's check, creating it while the day is current, so its row
 * (and the delivery hold it carries) exists before anything is delivered.
 * Creating it here or from the check's first batch is the same insert.
 */
export async function openSearchAlertCheckState(
  context: Pick<SearchAlertCheckContext, "database" | "client">,
  day: string,
  now: Date,
): Promise<SearchAlertCheckState> {
  const check = await openSearchAlertCheck(context, day, now);
  if (!check) return "missing";
  return check.status === "running" ? "running" : "finished";
}

/** Whether the vehicles a batch reads (or read) may be incomplete. */
async function readIsBlocked(
  context: SearchAlertCheckContext,
  read: SearchAlertCheckRead,
): Promise<boolean> {
  const [result] = await context.client.batch(
    [searchAlertCheckBlockerQuery(read)],
    "read",
  );
  const blocker = result?.rows[0]?.blocker;
  return blocker !== null && blocker !== undefined;
}

function intentStatement(params: {
  channel: "email" | "discord";
  check: SearchAlertCheckRow;
  read: SearchAlertCheckRead;
  search: SavedSearchRow;
  payload: SearchAlertData;
  createdAtMs: number;
}): InStatement {
  const guard = searchAlertCheckWriteGuard(params.read);
  const columns =
    params.channel === "email"
      ? {
          version: "email_config_version",
          enabled: "email_alerts_enabled",
          start: "email_start_sequence",
          expectedVersion: params.search.emailConfigVersion,
        }
      : {
          version: "discord_config_version",
          enabled: "discord_alerts_enabled",
          start: "discord_start_sequence",
          expectedVersion: params.search.discordConfigVersion,
        };
  return {
    sql: `
      insert into search_notification_intent (
        id, alert_check_id, publication_sequence, saved_search_id, user_id,
        channel, search_match_version, channel_config_version, payload,
        status, attempts, created_at
      )
      select ?, ?, ${WINDOW_PUBLICATION_SEQUENCE_SQL}, id, user_id, ?,
             search_match_version, ${columns.version}, ?, 'pending', 0, ?
      from saved_search
      where id = ?
        and search_match_version = ?
        and ${columns.version} = ?
        and ${columns.enabled} = 1
        and ${columns.start} < ${WINDOW_PUBLICATION_SEQUENCE_SQL}
        and last_checked_at is ?
        and ${guard.sql}
      on conflict(saved_search_id, publication_sequence, channel) do nothing
    `,
    args: [
      `${params.check.id}:${params.search.id}:${params.channel}`,
      params.check.id,
      params.check.checkedThrough.getTime(),
      params.channel,
      JSON.stringify(params.payload),
      params.createdAtMs,
      params.search.id,
      params.search.searchMatchVersion,
      columns.expectedVersion,
      params.check.checkedThrough.getTime(),
      params.search.lastCheckedAt?.getTime() ?? null,
      ...guard.args,
    ],
  };
}

/**
 * Writes a search's intents and advances its window in one transaction. A
 * write that did not apply is classified: the check stopped, its read may be
 * incomplete (retry), or the search is deferred with its window kept.
 */
async function checkpointSearch(
  context: SearchAlertCheckContext,
  params: {
    check: SearchAlertCheckRow;
    read: SearchAlertCheckRead;
    search: SavedSearchRow;
    alertData: SearchAlertData | null;
    quarantineReason: string | null;
    now: Date;
  },
): Promise<SearchOutcome> {
  const { check, read, search, alertData } = params;
  const channels = alertData
    ? (["email", "discord"] as const).filter((channel) =>
        channel === "email"
          ? search.emailAlertsEnabled
          : search.discordAlertsEnabled,
      )
    : [];
  const statements: InStatement[] = alertData
    ? channels.map((channel) =>
        intentStatement({
          channel,
          check,
          read,
          search,
          payload: alertData,
          createdAtMs: params.now.getTime(),
        }),
      )
    : [];
  statements.push(
    savedSearchAlertCheckpointStatement({
      read,
      searchId: search.id,
      searchMatchVersion: search.searchMatchVersion,
      expectedLastCheckedAtMs: search.lastCheckedAt?.getTime() ?? null,
      checkedThroughMs: check.checkedThrough.getTime(),
      alertChannels: channels,
      quarantine:
        params.quarantineReason === null
          ? null
          : { atMs: params.now.getTime(), reason: params.quarantineReason },
    }),
  );
  const results = await context.client.batch(statements, "write");
  const checkpoint = results.at(-1);
  if (!checkpoint) {
    throw new Error(
      `Search alert check ${check.id} returned no checkpoint for saved search ${search.id}. Retry the check; its cursor was not advanced.`,
    );
  }
  if (checkpoint.rowsAffected === 1) {
    const intentsCreated = results
      .slice(0, -1)
      .reduce((total, result) => total + result.rowsAffected, 0);
    return { status: "checked", intentsCreated };
  }
  const [current] = await context.database
    .select({
      status: searchAlertCheck.status,
      searchCursor: searchAlertCheck.searchCursor,
    })
    .from(searchAlertCheck)
    .where(eq(searchAlertCheck.id, check.id))
    .limit(1);
  if (
    !current ||
    current.status !== "running" ||
    current.searchCursor !== check.searchCursor
  ) {
    return { status: "interrupted", reason: "stopped" };
  }
  if (await readIsBlocked(context, read)) {
    return { status: "interrupted", reason: "waiting" };
  }
  // The search changed during the check, or its alert would share a sequence
  // with an earlier intent. Its window is kept for the next check.
  console.info("[Alerts] Saved search alert window kept for the next check", {
    checkId: check.id,
    searchId: search.id,
  });
  return { status: "checked", intentsCreated: 0 };
}

async function checkSearch(
  context: SearchAlertCheckContext,
  params: {
    check: SearchAlertCheckRow;
    read: SearchAlertCheckRead;
    search: SavedSearchRow;
    matchResult: PromiseSettledResult<AlertMatchStats> | undefined;
    now: Date;
  },
): Promise<SearchOutcome> {
  const { search } = params;
  const parsedFilters = parseSavedSearchFilters(search.filters);
  if (!parsedFilters.success || !search.lastCheckedAt) {
    return checkpointSearch(context, {
      ...params,
      alertData: null,
      quarantineReason: parsedFilters.success
        ? null
        : "This saved search has invalid filters. Recreate it to resume alerts.",
    });
  }
  if (!params.matchResult) {
    throw new Error(
      `Saved search ${search.id} has no batched match result in search alert check ${params.check.id}.`,
    );
  }
  if (params.matchResult.status === "rejected") throw params.matchResult.reason;
  const match = params.matchResult.value;
  if (match.completion.status !== "complete") {
    const message = `Saved search ${search.id} returned an incomplete Algolia scan (${match.completion.reason}).`;
    if (match.completion.reason !== "pagination-limit") {
      throw new Error(
        `${message} Its alert window was preserved; retry the check.`,
      );
    }
    // Advance past the oversized result set so later checks can continue.
    console.error(
      `[Alerts] ${message} The alert window advanced without sending it. Narrow this saved search to receive complete alerts.`,
      { checkId: params.check.id, searchId: search.id },
    );
    return checkpointSearch(context, {
      ...params,
      alertData: null,
      quarantineReason: `${message} Narrow this saved search to receive complete alerts.`,
    });
  }
  const alertData: SearchAlertData | null =
    match.matchedCount === 0
      ? null
      : {
          searchName: search.name,
          query: search.query,
          match: SearchAlertMatch.create(match.matchedCount, match.vehicles),
          searchUrl: `${context.appUrl}${buildSearchUrl(
            search.query,
            parsedFilters.data,
          )}`,
          searchId: search.id,
        };
  return checkpointSearch(context, {
    ...params,
    alertData,
    quarantineReason: null,
  });
}

/**
 * Checks the next batch of alert-enabled saved searches for the day, in id
 * order, against vehicles first seen in each search's window up to the
 * check's bound. One batched Algolia request covers the batch; searches with
 * no newer vehicles send none.
 */
export async function runSearchAlertCheckBatch(
  context: SearchAlertCheckContext,
  day: string,
  now: Date,
): Promise<SearchAlertCheckBatchResult> {
  // Paused alerts create no check, read no Algolia and move no window.
  if (!(await context.alertsEnabled())) return { status: "alerts_disabled" };
  const check = await openSearchAlertCheck(context, day, now);
  if (!check) return { status: "not_started" };
  if (check.status === "complete") {
    return {
      status: "complete",
      checkId: check.id,
      searchesProcessed: 0,
      intentsCreated: 0,
    };
  }
  if (check.status === "superseded") {
    return { status: "stopped", checkId: check.id };
  }
  // Reads start now; a commit that publishes after this is caught at write.
  const read: SearchAlertCheckRead = {
    checkId: check.id,
    expectedCursor: check.searchCursor,
    readStartedAtMs: now.getTime(),
  };
  if (await readIsBlocked(context, read)) {
    return { status: "waiting", checkId: check.id };
  }
  const alertsEnabled = or(
    eq(savedSearch.emailAlertsEnabled, true),
    eq(savedSearch.discordAlertsEnabled, true),
  );
  const searches = await context.database
    .select()
    .from(savedSearch)
    .where(
      check.searchCursor === null
        ? alertsEnabled
        : and(gt(savedSearch.id, check.searchCursor), alertsEnabled),
    )
    .orderBy(asc(savedSearch.id))
    .limit(MATCH_BATCH_SIZE);
  const [latest] = await context.database
    .select({ firstSeenAt: sql<number | null>`max(${vehicle.firstSeenAt})` })
    .from(vehicle)
    .where(lte(vehicle.firstSeenAt, check.checkedThrough));
  const latestFirstSeenAt = latest?.firstSeenAt ?? null;
  const matchable = searches.flatMap((search) => {
    const filters = parseSavedSearchFilters(search.filters);
    return filters.success && search.lastCheckedAt
      ? [
          {
            id: search.id,
            query: search.query,
            filters: filters.data,
            lastCheckedAt: search.lastCheckedAt,
          },
        ]
      : [];
  });
  const matches = await context.matchSearches(matchable, {
    checkedThrough: check.checkedThrough,
    latestFirstSeenAt:
      latestFirstSeenAt === null ? null : new Date(latestFirstSeenAt),
  });
  const matchesById = new Map(
    matchable.map((search, index) => [search.id, matches[index]]),
  );
  let intentsCreated = 0;
  for (const search of searches) {
    const outcome = await checkSearch(context, {
      check,
      read,
      search,
      matchResult: matchesById.get(search.id),
      now,
    });
    if (outcome.status === "interrupted") {
      return { status: outcome.reason, checkId: check.id };
    }
    intentsCreated += outcome.intentsCreated;
  }

  const finishing = searches.length < MATCH_BATCH_SIZE;
  const nextCursor = searches.at(-1)?.id ?? check.searchCursor;
  const advanced = await context.database
    .update(searchAlertCheck)
    .set({
      searchCursor: nextCursor,
      lastProgressAt: now,
      ...(finishing ? { status: "complete" as const, completedAt: now } : {}),
    })
    .where(
      and(
        eq(searchAlertCheck.id, check.id),
        eq(searchAlertCheck.status, "running"),
        check.searchCursor === null
          ? sql`${searchAlertCheck.searchCursor} is null`
          : eq(searchAlertCheck.searchCursor, check.searchCursor),
      ),
    );
  if (advanced.rowsAffected === 0) {
    return { status: "stopped", checkId: check.id };
  }
  return {
    status: finishing ? "complete" : "paused",
    checkId: check.id,
    searchesProcessed: searches.length,
    intentsCreated,
  };
}
