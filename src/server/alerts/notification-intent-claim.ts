import { and, asc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionRun, searchNotificationIntent } from "~/schema";

export function claimNotificationIntents(params: {
  database: LibSQLDatabase;
  now: Date;
  leaseMs: number;
  batchSize: number;
  claimToken: string;
}) {
  const stale = new Date(params.now.getTime() - params.leaseMs);
  const claimable = or(
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
  const releasedRun = sql`exists (
    select 1 from ${ingestionRun}
    where ${ingestionRun.id} = ${searchNotificationIntent.runId}
      and ${ingestionRun.status} = 'success'
      and ${ingestionRun.stage} = 'released'
  )`;
  const candidateIds = params.database
    .select({ id: searchNotificationIntent.id })
    .from(searchNotificationIntent)
    .where(and(claimable, releasedRun))
    .orderBy(asc(searchNotificationIntent.id))
    .limit(params.batchSize);
  return params.database
    .update(searchNotificationIntent)
    .set({
      status: "sending",
      claimToken: params.claimToken,
      claimedAt: params.now,
      attempts: sql`${searchNotificationIntent.attempts} + 1`,
    })
    .where(
      and(
        inArray(searchNotificationIntent.id, candidateIds),
        claimable,
        releasedRun,
      ),
    )
    .returning();
}

export async function cancelClaimedNotificationIntent(params: {
  database: LibSQLDatabase;
  intentId: string;
  claimToken: string;
  reason: string;
}): Promise<boolean> {
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
        eq(searchNotificationIntent.id, params.intentId),
        eq(searchNotificationIntent.status, "sending"),
        eq(searchNotificationIntent.claimToken, params.claimToken),
      ),
    );
  return cancelled.rowsAffected === 1;
}
