import { IngestionDay } from "../ingestion/ingestion-day";
import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import {
  ingestionRun,
  searchNotificationDelivery,
  searchNotificationIntent,
  user,
} from "~/schema";

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

const releasedRun = sql`exists (
  select 1 from ${ingestionRun}
  where ${ingestionRun.id} = ${searchNotificationIntent.runId}
    and ${ingestionRun.status} = 'success'
    and ${ingestionRun.stage} = 'released'
)`;

function claimValues(params: ClaimNotificationIntentGroupParams) {
  return {
    status: "sending",
    claimToken: params.claimToken,
    claimedAt: params.now,
    attempts: sql`${searchNotificationIntent.attempts} + 1`,
  } as const;
}

export async function claimNotificationIntentGroup(
  params: ClaimNotificationIntentGroupParams & { channel: "email" | "discord" },
) {
  const claimable = claimableNotificationIntent(params);
  const stale = params.now.getTime() - params.leaseMs;
  const database = params.database;
  const eligible = and(
    eq(searchNotificationIntent.channel, params.channel),
    claimable,
    releasedRun,
    sql`not exists (
        select 1 from search_notification_delivery d
        where d.user_id = ${searchNotificationIntent.userId}
          and d.channel = ${searchNotificationIntent.channel}
          and d.delivered_at >= ${IngestionDay.start(params.now).getTime()}
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
