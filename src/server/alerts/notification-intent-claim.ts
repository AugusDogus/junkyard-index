import { IngestionDay } from "../ingestion/ingestion-day";
import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import {
  ingestionRun,
  searchAlertCheck,
  searchNotificationDelivery,
  searchNotificationIntent,
  user,
} from "~/schema";
import { SearchAlertSchedule } from "./search-alert-schedule";

interface ClaimNotificationIntentGroupParams {
  database: LibSQLDatabase;
  now: Date;
  leaseMs: number;
  claimToken: string;
}

function claimableNotificationIntent(params: { now: Date; leaseMs: number }) {
  const stale = new Date(params.now.getTime() - params.leaseMs);
  return or(
    eq(searchNotificationIntent.status, "pending"),
    and(
      eq(searchNotificationIntent.status, "retry"),
      lte(searchNotificationIntent.nextAttemptAt, params.now),
    ),
    and(
      eq(searchNotificationIntent.status, "sending"),
      lt(searchNotificationIntent.claimedAt, stale),
    ),
  );
}

// An intent waits for its owner to finish, so each recipient's one digest a
// day covers every match: a daily alert check that is no longer running, or,
// for intents from before daily checks, a released ingestion run.
const ownerFinished = sql`(
  exists (
    select 1 from ${searchAlertCheck}
    where ${searchAlertCheck.id} = ${searchNotificationIntent.alertCheckId}
      and ${searchAlertCheck.status} <> 'running'
  )
  or exists (
    select 1 from ${ingestionRun}
    where ${ingestionRun.id} = ${searchNotificationIntent.runId}
      and ${ingestionRun.status} = 'success'
      and ${ingestionRun.stage} = 'released'
  )
)`;

/**
 * Until today's alert check finishes, a recipient's earlier intents wait for
 * it, so they share today's one digest with its matches instead of using up
 * the daily allowance first. That covers the hours from the 07:00 UTC day
 * boundary until the pass or the deadline creates today's check, and the
 * check while it progresses. A check that stopped progressing (Algolia
 * failing, or stuck), or no check an hour past the deadline, releases them
 * (the deadline cron opens the row on its first run). Intents
 * already grouped into a digest are not held: nothing new can join their
 * group.
 */
function heldForTodaysCheck(now: Date) {
  const today = IngestionDay.key(now);
  const awaitingCheck = SearchAlertSchedule.isPastMissingCheckGrace(now)
    ? 0
    : 1;
  return sql`(
    ${searchNotificationIntent.deliveryGroupId} is null
    and (
      exists (
        select 1 from ${searchAlertCheck} today
        where today.day = ${today}
          and today.status = 'running'
          and today.last_progress_at >= ${now.getTime() - SearchAlertSchedule.staleAfterMs}
      )
      or (
        ${awaitingCheck} = 1
        and not exists (
          select 1 from ${searchAlertCheck} today
          where today.day = ${today}
        )
      )
    )
  )`;
}

function claimValues(params: ClaimNotificationIntentGroupParams) {
  return {
    status: "sending",
    claimToken: params.claimToken,
    claimedAt: params.now,
    attempts: sql`${searchNotificationIntent.attempts} + 1`,
  } as const;
}

/** Intents a delivery worker could claim now, on any channel. */
function deliverableNotificationIntent(params: { now: Date; leaseMs: number }) {
  const stale = params.now.getTime() - params.leaseMs;
  return and(
    claimableNotificationIntent(params),
    ownerFinished,
    sql`not ${heldForTodaysCheck(params.now)}`,
    sql`(
        ${searchNotificationIntent.status} in ('retry', 'sending')
        or not exists (
          select 1 from search_notification_delivery d
          where d.user_id = ${searchNotificationIntent.userId}
            and d.channel = ${searchNotificationIntent.channel}
            and d.delivered_at >= ${IngestionDay.start(params.now).getTime()}
        )
      )`,
    sql`not exists (
        select 1 from search_notification_intent busy
        where busy.user_id = ${searchNotificationIntent.userId}
          and busy.channel = ${searchNotificationIntent.channel}
          and busy.status = 'sending' and busy.claimed_at >= ${stale}
      )`,
    sql`(${searchNotificationIntent.deliveryGroupId} is not null or not exists (
        select 1 from search_notification_intent queued
        where queued.user_id = ${searchNotificationIntent.userId}
          and queued.channel = ${searchNotificationIntent.channel}
          and queued.delivery_group_id is not null
          and queued.status in ('pending', 'retry', 'sending')
      ))`,
  );
}

/**
 * Whether a delivery worker would find work now. Intents held back by a
 * recipient's daily limit do not count, so callers do not start empty workers.
 */
export async function hasDeliverableNotificationIntent(params: {
  database: LibSQLDatabase;
  now: Date;
  leaseMs: number;
}): Promise<boolean> {
  const [intent] = await params.database
    .select({ id: searchNotificationIntent.id })
    .from(searchNotificationIntent)
    .where(deliverableNotificationIntent(params))
    .limit(1);
  return intent !== undefined;
}

export async function claimNotificationIntentGroup(
  params: ClaimNotificationIntentGroupParams & { channel: "email" | "discord" },
) {
  const database = params.database;
  const eligible = and(
    eq(searchNotificationIntent.channel, params.channel),
    deliverableNotificationIntent(params),
  );
  const [candidate] = await database
    .select()
    .from(searchNotificationIntent)
    .where(eligible)
    .orderBy(
      asc(searchNotificationIntent.createdAt),
      asc(searchNotificationIntent.id),
    )
    .limit(1);
  if (!candidate) return [];

  // The non-correlated ID subquery is evaluated before the atomic update.
  // Recheck the lease and daily limit here: another worker may have won since selection.
  const members = database
    .select({ id: searchNotificationIntent.id })
    .from(searchNotificationIntent)
    .where(
      and(
        eligible,
        eq(searchNotificationIntent.userId, candidate.userId),
        candidate.deliveryGroupId === null
          ? isNull(searchNotificationIntent.deliveryGroupId)
          : eq(
              searchNotificationIntent.deliveryGroupId,
              candidate.deliveryGroupId,
            ),
      ),
    );
  return database
    .update(searchNotificationIntent)
    .set({
      ...claimValues(params),
      deliveryGroupId:
        candidate.deliveryGroupId ??
        `${params.channel}:digest:${params.claimToken}`,
    })
    .where(inArray(searchNotificationIntent.id, members))
    .returning();
}

export async function markNotificationGroupDelivered(params: {
  database: LibSQLDatabase;
  userId: string;
  channel: "email" | "discord";
  intentIds: readonly string[];
  claimToken: string;
  now: Date;
}): Promise<void> {
  if (params.intentIds.length === 0) return;
  const claimed = and(
    inArray(searchNotificationIntent.id, params.intentIds),
    eq(searchNotificationIntent.status, "sending"),
    eq(searchNotificationIntent.claimToken, params.claimToken),
  );
  // Called only after the provider confirms success. The recipient was captured
  // before sending: settings changes may cancel or delete every intent in flight.
  // Even a successful stale worker consumed this recipient's daily allowance;
  // only its intent updates remain fenced by the original claim token.
  await params.database.batch([
    params.database
      .insert(searchNotificationDelivery)
      .select(
        params.database
          .select({
            userId: user.id,
            channel: sql<string>`${params.channel}`.as("channel"),
            deliveredAt: sql<number>`${params.now.getTime()}`.as(
              "delivered_at",
            ),
          })
          .from(user)
          .where(eq(user.id, params.userId)),
      )
      .onConflictDoUpdate({
        target: [
          searchNotificationDelivery.userId,
          searchNotificationDelivery.channel,
        ],
        set: { deliveredAt: sql`max(delivered_at, ${params.now.getTime()})` },
      }),
    params.database
      .update(searchNotificationIntent)
      .set({
        status: "delivered",
        deliveredAt: params.now,
        claimToken: null,
        lastError: null,
      })
      .where(claimed),
  ]);
}

export async function cancelClaimedNotificationIntents(params: {
  database: LibSQLDatabase;
  intentIds: readonly string[];
  claimToken: string;
  reason: string;
}): Promise<number> {
  if (params.intentIds.length === 0) return 0;
  const cancelled = await params.database
    .update(searchNotificationIntent)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      claimToken: null,
      lastError: params.reason,
    })
    .where(
      and(
        inArray(searchNotificationIntent.id, params.intentIds),
        eq(searchNotificationIntent.status, "sending"),
        eq(searchNotificationIntent.claimToken, params.claimToken),
      ),
    );
  return cancelled.rowsAffected;
}
