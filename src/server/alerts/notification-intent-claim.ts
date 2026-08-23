import { and, asc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionRun, searchNotificationIntent } from "~/schema";

interface ClaimNotificationIntentGroupParams {
  database: LibSQLDatabase;
  now: Date;
  leaseMs: number;
  claimToken: string;
}

interface ClaimNotificationIntentParams extends ClaimNotificationIntentGroupParams {
  batchSize: number;
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

export async function claimEmailNotificationIntentGroup(
  params: ClaimNotificationIntentGroupParams,
) {
  const claimable = claimableNotificationIntent(params);
  const [candidate] = await params.database
    .select({
      runId: searchNotificationIntent.runId,
      publicationSequence: searchNotificationIntent.publicationSequence,
      userId: searchNotificationIntent.userId,
    })
    .from(searchNotificationIntent)
    .where(
      and(
        eq(searchNotificationIntent.channel, "email"),
        claimable,
        releasedRun,
      ),
    )
    .orderBy(asc(searchNotificationIntent.id))
    .limit(1);
  if (!candidate) return [];

  return params.database
    .update(searchNotificationIntent)
    .set(claimValues(params))
    .where(
      and(
        eq(searchNotificationIntent.channel, "email"),
        eq(searchNotificationIntent.runId, candidate.runId),
        eq(
          searchNotificationIntent.publicationSequence,
          candidate.publicationSequence,
        ),
        eq(searchNotificationIntent.userId, candidate.userId),
        claimable,
        releasedRun,
      ),
    )
    .returning();
}

export function claimDiscordNotificationIntents(
  params: ClaimNotificationIntentParams,
) {
  const claimable = claimableNotificationIntent(params);
  const candidateIds = params.database
    .select({ id: searchNotificationIntent.id })
    .from(searchNotificationIntent)
    .where(
      and(
        eq(searchNotificationIntent.channel, "discord"),
        claimable,
        releasedRun,
      ),
    )
    .orderBy(asc(searchNotificationIntent.id))
    .limit(params.batchSize);
  return params.database
    .update(searchNotificationIntent)
    .set(claimValues(params))
    .where(
      and(
        eq(searchNotificationIntent.channel, "discord"),
        inArray(searchNotificationIntent.id, candidateIds),
        claimable,
        releasedRun,
      ),
    )
    .returning();
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
