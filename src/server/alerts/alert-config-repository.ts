import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionRun, savedSearch, searchNotificationIntent } from "~/schema";

export type AlertChannel = "email" | "discord";

export async function currentSearchPublicationSequence(
  database: LibSQLDatabase,
): Promise<number> {
  const [row] = await database
    .select({
      sequence: sql<number>`coalesce(max(${ingestionRun.publicationSequence}), 0)`,
    })
    .from(ingestionRun);
  return row?.sequence ?? 0;
}

async function setAlertChannel(params: {
  database: LibSQLDatabase;
  where: SQL;
  channel: AlertChannel;
  enabled: boolean;
}): Promise<string[]> {
  const startSequence = params.enabled
    ? sql<number>`(
          select coalesce(max(publication_sequence), 0)
          from ingestion_run
        )`
    : undefined;
  const updateQuery =
    params.channel === "email"
      ? params.database
          .update(savedSearch)
          .set({
            emailAlertsEnabled: params.enabled,
            emailConfigVersion: sql`${savedSearch.emailConfigVersion} + 1`,
            ...(startSequence === undefined
              ? {}
              : {
                  emailStartSequence: startSequence,
                  lastCheckedAt: sql`case
                      when ${savedSearch.emailAlertsEnabled} = 0
                       and ${savedSearch.discordAlertsEnabled} = 0
                        then ${new Date()}
                      else ${savedSearch.lastCheckedAt}
                    end`,
                }),
          })
          .where(params.where)
          .returning({ id: savedSearch.id })
      : params.database
          .update(savedSearch)
          .set({
            discordAlertsEnabled: params.enabled,
            discordConfigVersion: sql`${savedSearch.discordConfigVersion} + 1`,
            ...(startSequence === undefined
              ? {}
              : {
                  discordStartSequence: startSequence,
                  lastCheckedAt: sql`case
                      when ${savedSearch.emailAlertsEnabled} = 0
                       and ${savedSearch.discordAlertsEnabled} = 0
                        then ${new Date()}
                      else ${savedSearch.lastCheckedAt}
                    end`,
                }),
          })
          .where(params.where)
          .returning({ id: savedSearch.id });
  if (params.enabled) {
    const [updated] = await params.database.batch([updateQuery]);
    return updated.map(({ id }) => id);
  }

  const matchingSearchIds = params.database
    .select({ id: savedSearch.id })
    .from(savedSearch)
    .where(params.where);
  const [updated] = await params.database.batch([
    updateQuery,
    params.database
      .update(searchNotificationIntent)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        claimToken: null,
      })
      .where(
        and(
          inArray(searchNotificationIntent.savedSearchId, matchingSearchIds),
          eq(searchNotificationIntent.channel, params.channel),
          sql`${searchNotificationIntent.deliveredAt} is null`,
          sql`${searchNotificationIntent.cancelledAt} is null`,
        ),
      ),
  ]);
  return updated.map(({ id }) => id);
}

export function setSearchAlertChannel(params: {
  database: LibSQLDatabase;
  searchId: string;
  userId?: string;
  channel: AlertChannel;
  enabled: boolean;
}) {
  return setAlertChannel({
    database: params.database,
    where:
      params.userId === undefined
        ? eq(savedSearch.id, params.searchId)
        : sql`${savedSearch.id} = ${params.searchId} and ${savedSearch.userId} = ${params.userId}`,
    channel: params.channel,
    enabled: params.enabled,
  });
}

export function setUserAlertChannel(params: {
  database: LibSQLDatabase;
  userId: string;
  channel: AlertChannel;
  enabled: boolean;
}) {
  return setAlertChannel({
    database: params.database,
    where: eq(savedSearch.userId, params.userId),
    channel: params.channel,
    enabled: params.enabled,
  });
}
