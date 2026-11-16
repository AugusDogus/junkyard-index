import { canMatchSettledIngestionAlerts } from "./settled-ingestion-alerts";
import type { AlertMatchStats } from "~/lib/algolia-alert-search";
import { and, asc, eq, gt, or, sql } from "drizzle-orm";
import { env } from "~/env";
import { getAlertMatchStatsBatch } from "~/server/alerts/algolia-alert-search";
import { db, dbClient } from "~/lib/db";
import {
  SearchAlertMatch,
  type SearchAlertData,
} from "~/lib/search-alert-data";
import { parseSavedSearchFilters } from "~/lib/saved-search-filters";
import { buildSearchUrl } from "~/lib/search-utils";
import { ingestionRun, savedSearch, vehicle } from "~/schema";
import {
  processAlertMatchBatch,
  QuarantinedAlertMatchError,
} from "./alert-match-batch";
import { classifyDurableAlertRun } from "./durable-alert-run-state";
import { savedSearchAlertCheckpointStatement } from "./alert-search-checkpoint";

const MATCH_BATCH_SIZE = 50;

function intentId(
  runId: string,
  searchId: string,
  channel: "email" | "discord",
) {
  return `${runId}:${searchId}:${channel}`;
}

async function checkpointMatchedSearch(params: {
  runId: string;
  publicationSequence: number;
  expectedRunCursor: string | null;
  search: typeof savedSearch.$inferSelect;
  checkedAt: Date;
  alertData: SearchAlertData | null;
  quarantineReason?: string | null;
}) {
  const statements = [];
  if (params.alertData && params.search.emailAlertsEnabled) {
    statements.push({
      sql: `
        insert into search_notification_intent (
          id, run_id, publication_sequence, saved_search_id, user_id,
          channel, search_match_version, channel_config_version, payload,
          status, attempts, created_at
        )
        select ?, ?, ?, id, user_id, 'email', search_match_version,
               email_config_version, ?, 'pending', 0, ?
        from saved_search
        where id = ?
          and search_match_version = ?
          and email_config_version = ?
          and email_alerts_enabled = 1
          and email_start_sequence < ?
          and exists (
            select 1 from ingestion_run
            where id = ? and status = 'running' and active_slot = 1
              and stage = 'match_alerts' and publication_sequence = ?
              and alert_match_cursor is ?
          )
        on conflict(saved_search_id, publication_sequence, channel) do nothing
      `,
      args: [
        intentId(params.runId, params.search.id, "email"),
        params.runId,
        params.publicationSequence,
        JSON.stringify(params.alertData),
        params.checkedAt.getTime(),
        params.search.id,
        params.search.searchMatchVersion,
        params.search.emailConfigVersion,
        params.publicationSequence,
        params.runId,
        params.publicationSequence,
        params.expectedRunCursor,
      ],
    });
  }
  if (params.alertData && params.search.discordAlertsEnabled) {
    statements.push({
      sql: `
        insert into search_notification_intent (
          id, run_id, publication_sequence, saved_search_id, user_id,
          channel, search_match_version, channel_config_version, payload,
          status, attempts, created_at
        )
        select ?, ?, ?, id, user_id, 'discord', search_match_version,
               discord_config_version, ?, 'pending', 0, ?
        from saved_search
        where id = ?
          and search_match_version = ?
          and discord_config_version = ?
          and discord_alerts_enabled = 1
          and discord_start_sequence < ?
          and exists (
            select 1 from ingestion_run
            where id = ? and status = 'running' and active_slot = 1
              and stage = 'match_alerts' and publication_sequence = ?
              and alert_match_cursor is ?
          )
        on conflict(saved_search_id, publication_sequence, channel) do nothing
      `,
      args: [
        intentId(params.runId, params.search.id, "discord"),
        params.runId,
        params.publicationSequence,
        JSON.stringify(params.alertData),
        params.checkedAt.getTime(),
        params.search.id,
        params.search.searchMatchVersion,
        params.search.discordConfigVersion,
        params.publicationSequence,
        params.runId,
        params.publicationSequence,
        params.expectedRunCursor,
      ],
    });
  }
  statements.push(
    savedSearchAlertCheckpointStatement({
      checkedAtMs: params.checkedAt.getTime(),
      publicationSequence: params.publicationSequence,
      searchId: params.search.id,
      searchMatchVersion: params.search.searchMatchVersion,
      runId: params.runId,
      expectedRunCursor: params.expectedRunCursor,
      quarantineReason: params.quarantineReason ?? null,
    }),
  );
  const results = await dbClient.batch(statements, "write");
  const checkpoint = results.at(-1);
  if (!checkpoint) {
    throw new Error(
      `Saved search ${params.search.id} matching returned no checkpoint.`,
    );
  }
  if (checkpoint.rowsAffected === 1) return true;
  const [run] = await db
    .select({
      status: ingestionRun.status,
      activeSlot: ingestionRun.activeSlot,
      stage: ingestionRun.stage,
      publicationSequence: ingestionRun.publicationSequence,
      alertMatchCursor: ingestionRun.alertMatchCursor,
    })
    .from(ingestionRun)
    .where(eq(ingestionRun.id, params.runId))
    .limit(1);
  if (
    !run ||
    run.status !== "running" ||
    run.activeSlot !== 1 ||
    run.stage !== "match_alerts" ||
    run.publicationSequence !== params.publicationSequence ||
    run.alertMatchCursor !== params.expectedRunCursor
  ) {
    throw new Error(
      `Ingestion run ${params.runId} stopped while matching saved search ${params.search.id}.`,
    );
  }
  return false;
}

async function matchSearch(params: {
  runId: string;
  publicationSequence: number;
  expectedRunCursor: string | null;
  search: typeof savedSearch.$inferSelect;
  checkedAt: Date;
  matchResult: PromiseSettledResult<AlertMatchStats> | undefined;
}) {
  const checkedAt = params.checkedAt;
  const parsedFilters = parseSavedSearchFilters(params.search.filters);
  if (!parsedFilters.success || !params.search.lastCheckedAt) {
    await checkpointMatchedSearch({
      ...params,
      checkedAt,
      alertData: null,
      quarantineReason: parsedFilters.success
        ? null
        : "This saved search has invalid filters. Recreate it to resume alerts.",
    });
    return 0;
  }
  if (!params.matchResult)
    throw new Error(
      `Saved search ${params.search.id} has no batched match result.`,
    );
  if (params.matchResult.status === "rejected") throw params.matchResult.reason;
  const match = params.matchResult.value;
  if (match.completion.status !== "complete") {
    const message = `Saved search ${params.search.id} returned an incomplete Algolia scan (${match.completion.reason}).`;
    if (match.completion.reason === "pagination-limit") {
      await checkpointMatchedSearch({
        ...params,
        checkedAt,
        alertData: null,
        quarantineReason: `${message} Narrow this saved search to receive complete alerts.`,
      });
      throw new QuarantinedAlertMatchError(
        `${message} The alert window advanced without sending this oversized result set so later incremental matches can continue. Narrow this saved search to receive complete alerts.`,
      );
    }
    throw new Error(
      `${message} Its durable match cursor was preserved for retry.`,
    );
  }
  const alertData: SearchAlertData | null =
    match.matchedCount === 0
      ? null
      : {
          searchName: params.search.name,
          query: params.search.query,
          match: SearchAlertMatch.create(match.matchedCount, match.vehicles),
          searchUrl: `${env.NEXT_PUBLIC_APP_URL}${buildSearchUrl(
            params.search.query,
            parsedFilters.data,
          )}`,
          searchId: params.search.id,
        };
  await checkpointMatchedSearch({
    ...params,
    checkedAt,
    alertData,
    quarantineReason: null,
  });
  if (!alertData) return 0;
  return (
    Number(params.search.emailAlertsEnabled) +
    Number(params.search.discordAlertsEnabled)
  );
}

export type DurableAlertMatchingBatchResult =
  | { status: "stopped"; searchesProcessed: 0; intentsCreated: 0 }
  | { status: "paused"; searchesProcessed: number; intentsCreated: number }
  | { status: "complete"; searchesProcessed: number; intentsCreated: number };

async function recordAlertMatchFailure(
  runId: string,
  searchId: string,
  error: unknown,
) {
  const detail = error instanceof Error ? error.message : String(error);
  const message = `Saved search ${searchId} alert matching failed: ${detail}`;
  console.error("[Ingestion] Saved search alert matching skipped", {
    runId,
    searchId,
    error,
  });
  if (error instanceof QuarantinedAlertMatchError) return;
  await db.run(sql`
    update ingestion_run
    set execution_errors = case
          when execution_errors is null then json_array(${message})
          else json_insert(execution_errors, '$[#]', ${message})
        end,
        last_progress_at = ${Date.now()}
    where id = ${runId}
      and status = 'running'
      and active_slot = 1
      and stage = 'match_alerts'
  `);
}

export async function runDurableAlertMatchingBatch(
  runId: string,
): Promise<DurableAlertMatchingBatchResult> {
  const [run] = await db
    .select({
      stage: ingestionRun.stage,
      publicationSequence: ingestionRun.publicationSequence,
      alertMatchCursor: ingestionRun.alertMatchCursor,
      status: ingestionRun.status,
      activeSlot: ingestionRun.activeSlot,
    })
    .from(ingestionRun)
    .where(eq(ingestionRun.id, runId))
    .limit(1);
  if (!run) throw new Error(`Ingestion run ${runId} does not exist.`);
  const disposition = classifyDurableAlertRun(run);
  if (disposition.status === "complete") {
    return { status: "complete", searchesProcessed: 0, intentsCreated: 0 };
  }
  if (disposition.status === "stopped") {
    return { status: "stopped", searchesProcessed: 0, intentsCreated: 0 };
  }
  if (disposition.status === "invalid") {
    throw new Error(
      `Ingestion run ${runId} cannot match alerts from stage ${run.stage}.`,
    );
  }
  const publicationSequence = disposition.publicationSequence;
  const matchSettled =
    run.alertMatchCursor !== null ||
    (await canMatchSettledIngestionAlerts(db, runId));
  const searches = !matchSettled
    ? []
    : run.alertMatchCursor === null
      ? await db
          .select()
          .from(savedSearch)
          .where(
            or(
              eq(savedSearch.emailAlertsEnabled, true),
              eq(savedSearch.discordAlertsEnabled, true),
            ),
          )
          .orderBy(asc(savedSearch.id))
          .limit(MATCH_BATCH_SIZE)
      : await db
          .select()
          .from(savedSearch)
          .where(
            and(
              gt(savedSearch.id, run.alertMatchCursor),
              or(
                eq(savedSearch.emailAlertsEnabled, true),
                eq(savedSearch.discordAlertsEnabled, true),
              ),
            ),
          )
          .orderBy(asc(savedSearch.id))
          .limit(MATCH_BATCH_SIZE);
  const checkedAt = new Date();
  const [latest] = await db
    .select({ firstSeenAt: sql<number | null>`max(${vehicle.firstSeenAt})` })
    .from(vehicle);
  const matchableSearches = searches.flatMap((search) => {
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
  const latestFirstSeenAt = latest?.firstSeenAt ?? null;
  const matches = await getAlertMatchStatsBatch(
    matchableSearches,
    latestFirstSeenAt === null ? null : new Date(latestFirstSeenAt),
  );
  const matchesById = new Map(
    matchableSearches.map((search, index) => [search.id, matches[index]]),
  );
  const intentsCreated = await processAlertMatchBatch(searches, {
    match: (search) =>
      matchSearch({
        runId,
        publicationSequence,
        expectedRunCursor: run.alertMatchCursor,
        search,
        checkedAt,
        matchResult: matchesById.get(search.id),
      }),
    recordFailure: (search, error) =>
      recordAlertMatchFailure(runId, search.id, error),
  });
  const finishing = searches.length < MATCH_BATCH_SIZE;
  const now = new Date();
  const checkpointed = await db
    .update(ingestionRun)
    .set(
      finishing
        ? {
            status: "success",
            stage: "released",
            activeSlot: null,
            alertMatchCursor: searches.at(-1)?.id ?? run.alertMatchCursor,
            alertMatchingCompletedAt: matchSettled ? now : null,
            releasedAt: now,
            completedAt: now,
            lastProgressAt: now,
          }
        : {
            alertMatchCursor: searches.at(-1)?.id ?? run.alertMatchCursor,
            lastProgressAt: now,
          },
    )
    .where(
      and(
        eq(ingestionRun.id, runId),
        eq(ingestionRun.status, "running"),
        eq(ingestionRun.activeSlot, 1),
        eq(ingestionRun.stage, "match_alerts"),
        run.alertMatchCursor === null
          ? sql`${ingestionRun.alertMatchCursor} is null`
          : eq(ingestionRun.alertMatchCursor, run.alertMatchCursor),
      ),
    );
  if (checkpointed.rowsAffected === 0) {
    return { status: "stopped", searchesProcessed: 0, intentsCreated: 0 };
  }
  return {
    status: finishing ? "complete" : "paused",
    searchesProcessed: searches.length,
    intentsCreated,
  };
}
