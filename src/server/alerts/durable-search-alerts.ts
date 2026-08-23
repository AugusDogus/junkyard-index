import { and, asc, eq, gt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { env } from "~/env";
import { getAlertMatchStats } from "~/lib/algolia-alert-search";
import { polarClient } from "~/lib/auth";
import { db, dbClient } from "~/lib/db";
import { sendDiscordAlert } from "~/lib/discord";
import { sendEmailDigest } from "~/lib/email";
import {
  SearchAlertDigest,
  SearchAlertMatch,
  type SearchAlertData,
} from "~/lib/search-alert-data";
import { parseSavedSearchFilters } from "~/lib/saved-search-filters";
import { buildSearchUrl } from "~/lib/search-utils";
import {
  ingestionRun,
  savedSearch,
  searchNotificationIntent,
  user,
} from "~/schema";
import {
  processAlertMatchBatch,
  QuarantinedAlertMatchError,
} from "./alert-match-batch";
import { classifyDurableAlertRun } from "./durable-alert-run-state";
import { savedSearchAlertCheckpointStatement } from "./alert-search-checkpoint";
import {
  cancelClaimedNotificationIntent,
  claimNotificationIntents,
} from "./notification-intent-claim";
import { evaluateNotificationIntent } from "./notification-intent-policy";

const MATCH_BATCH_SIZE = 20;
const DELIVERY_BATCH_SIZE = 20;
const DELIVERY_LEASE_MS = 15 * 60 * 1000;

const SearchVehicleSchema = z
  .object({
    id: z.string(),
    year: z.number(),
    make: z.string(),
    model: z.string(),
    color: z.string(),
    vin: z.string(),
    stockNumber: z.string(),
    availableDate: z.string(),
    source: z.enum([
      "row52",
      "pyp",
      "autorecycler",
      "pullapart",
      "upullitne",
      "upullitdavie",
      "gopullit",
    ]),
    locationCode: z.string(),
    locationName: z.string(),
    locationCity: z.string(),
    state: z.string(),
    stateAbbr: z.string(),
    lat: z.number(),
    lng: z.number(),
    distance: z.number(),
    section: z.string(),
    row: z.string(),
    space: z.string(),
    imageUrl: z.string().nullable(),
    detailsUrl: z.string(),
    partsUrl: z.string(),
    pricesUrl: z.string(),
    engine: z.string().optional(),
    trim: z.string().optional(),
    transmission: z.string().optional(),
    isMissing: z.boolean().optional(),
    missingSinceAt: z.string().optional(),
    missingRunCount: z.number().optional(),
  })
  .strict();

const IntentPayloadSchema = z
  .object({
    searchName: z.string(),
    query: z.string(),
    searchUrl: z.string(),
    searchId: z.string(),
    match: z.object({
      count: z.number().int().positive(),
      previewVehicles: z.array(SearchVehicleSchema),
    }),
  })
  .strict();

function parseIntentPayload(value: string): SearchAlertData {
  const parsed = IntentPayloadSchema.parse(JSON.parse(value));
  return {
    searchName: parsed.searchName,
    query: parsed.query,
    searchUrl: parsed.searchUrl,
    searchId: parsed.searchId,
    match: SearchAlertMatch.create(
      parsed.match.count,
      parsed.match.previewVehicles,
    ),
  };
}

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
}) {
  const checkedAt = new Date();
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
  const match = await getAlertMatchStats(
    params.search.query,
    parsedFilters.data,
    params.search.lastCheckedAt,
  );
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
  const searches =
    run.alertMatchCursor === null
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
  const intentsCreated = await processAlertMatchBatch(searches, {
    match: (search) =>
      matchSearch({
        runId,
        publicationSequence,
        expectedRunCursor: run.alertMatchCursor,
        search,
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
            alertMatchingCompletedAt: now,
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

async function claimDeliveryBatch() {
  const now = new Date();
  return claimNotificationIntents({
    database: db,
    now,
    leaseMs: DELIVERY_LEASE_MS,
    batchSize: DELIVERY_BATCH_SIZE,
    claimToken: crypto.randomUUID(),
  });
}

async function cancelIntent(
  intent: typeof searchNotificationIntent.$inferSelect,
  reason: string,
) {
  if (intent.claimToken === null) {
    throw new Error(
      `Cannot cancel unclaimed notification intent ${intent.id}.`,
    );
  }
  await cancelClaimedNotificationIntent({
    database: db,
    intentId: intent.id,
    claimToken: intent.claimToken,
    reason,
  });
}

async function retryIntent(
  intent: typeof searchNotificationIntent.$inferSelect,
  error: string,
) {
  if (intent.claimToken === null) {
    throw new Error(`Cannot retry unclaimed notification intent ${intent.id}.`);
  }
  const delayMs = Math.min(
    24 * 60 * 60 * 1000,
    60 * 60 * 1000 * 2 ** Math.min(5, intent.attempts),
  );
  await db
    .update(searchNotificationIntent)
    .set({
      status: "retry",
      claimToken: null,
      lastError: error,
      nextAttemptAt: new Date(Date.now() + delayMs),
    })
    .where(
      and(
        eq(searchNotificationIntent.id, intent.id),
        eq(searchNotificationIntent.claimToken, intent.claimToken),
      ),
    );
}

async function hasActiveSubscription(userId: string): Promise<boolean> {
  const state = await polarClient.customers.getStateExternal({
    externalId: userId,
  });
  return state.activeSubscriptions.length > 0;
}

async function deliverClaimedIntent(
  intent: typeof searchNotificationIntent.$inferSelect,
) {
  if (intent.claimToken === null) {
    throw new Error(
      `Cannot deliver unclaimed notification intent ${intent.id}.`,
    );
  }
  const [target] = await db
    .select({
      searchId: savedSearch.id,
      userId: savedSearch.userId,
      searchMatchVersion: savedSearch.searchMatchVersion,
      emailConfigVersion: savedSearch.emailConfigVersion,
      discordConfigVersion: savedSearch.discordConfigVersion,
      emailAlertsEnabled: savedSearch.emailAlertsEnabled,
      discordAlertsEnabled: savedSearch.discordAlertsEnabled,
      emailStartSequence: savedSearch.emailStartSequence,
      discordStartSequence: savedSearch.discordStartSequence,
      email: user.email,
      discordId: user.discordId,
      discordAppInstalled: user.discordAppInstalled,
    })
    .from(savedSearch)
    .innerJoin(user, eq(user.id, savedSearch.userId))
    .where(eq(savedSearch.id, intent.savedSearchId))
    .limit(1);
  if (!target) return cancelIntent(intent, "saved_search_deleted");
  if (target.userId !== intent.userId) {
    return cancelIntent(intent, "saved_search_owner_changed");
  }
  if (intent.channel !== "email" && intent.channel !== "discord") {
    return cancelIntent(intent, "unknown_channel");
  }
  const policy = evaluateNotificationIntent(
    {
      channel: intent.channel,
      publicationSequence: intent.publicationSequence,
      searchMatchVersion: intent.searchMatchVersion,
      channelConfigVersion: intent.channelConfigVersion,
    },
    {
      searchMatchVersion: target.searchMatchVersion,
      emailConfigVersion: target.emailConfigVersion,
      discordConfigVersion: target.discordConfigVersion,
      emailAlertsEnabled: target.emailAlertsEnabled,
      discordAlertsEnabled: target.discordAlertsEnabled,
      emailStartSequence: target.emailStartSequence,
      discordStartSequence: target.discordStartSequence,
      discordReady: target.discordAppInstalled && target.discordId !== null,
    },
  );
  if (policy.status === "cancel") {
    return cancelIntent(intent, policy.reason);
  }

  let subscribed: boolean;
  try {
    subscribed = await hasActiveSubscription(intent.userId);
  } catch (error) {
    return retryIntent(
      intent,
      error instanceof Error ? error.message : "subscription_check_failed",
    );
  }
  if (!subscribed) return cancelIntent(intent, "subscription_inactive");

  let payload: SearchAlertData;
  try {
    payload = parseIntentPayload(intent.payload);
  } catch (error) {
    return cancelIntent(
      intent,
      error instanceof Error ? error.message : "invalid_intent_payload",
    );
  }
  const delivery =
    intent.channel === "email"
      ? await sendEmailDigest(
          { userId: intent.userId, email: target.email },
          SearchAlertDigest.create([payload], 1, payload.match.count),
          { idempotencyKey: intent.id },
        )
      : await sendDiscordAlert(target.discordId ?? "", payload, {
          idempotencyKey: intent.id,
        });
  if (!delivery.success) return retryIntent(intent, delivery.error);
  await db
    .update(searchNotificationIntent)
    .set({
      status: "delivered",
      deliveredAt: new Date(),
      claimToken: null,
      lastError: null,
    })
    .where(
      and(
        eq(searchNotificationIntent.id, intent.id),
        eq(searchNotificationIntent.claimToken, intent.claimToken),
      ),
    );
}

export interface DurableAlertDeliveryBatchResult {
  status: "paused" | "complete";
  intentsProcessed: number;
}

export async function deliverDurableAlertIntentsBatch(): Promise<DurableAlertDeliveryBatchResult> {
  const intents = await claimDeliveryBatch();
  for (const intent of intents) await deliverClaimedIntent(intent);
  return {
    status: intents.length < DELIVERY_BATCH_SIZE ? "complete" : "paused",
    intentsProcessed: intents.length,
  };
}
