import { and, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import {
  parseSavedSearchFilters,
  savedSearchMatchCriteriaKey,
} from "~/lib/saved-search-filters";
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

export async function updateSavedSearch(params: {
  database: LibSQLDatabase;
  searchId: string;
  userId: string;
  name: string;
  query: string;
  filters: string;
  emailAlertsEnabled?: boolean;
  discordAlertsEnabled?: boolean;
}): Promise<boolean> {
  const nextFilters = parseSavedSearchFilters(params.filters);
  if (!nextFilters.success) {
    throw new Error(
      `Cannot update saved search ${params.searchId}: the new filters failed validation.`,
    );
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [existing] = await params.database
      .select({
        query: savedSearch.query,
        filters: savedSearch.filters,
        searchMatchVersion: savedSearch.searchMatchVersion,
        emailAlertsEnabled: savedSearch.emailAlertsEnabled,
        discordAlertsEnabled: savedSearch.discordAlertsEnabled,
        emailConfigVersion: savedSearch.emailConfigVersion,
        discordConfigVersion: savedSearch.discordConfigVersion,
      })
      .from(savedSearch)
      .where(
        and(
          eq(savedSearch.id, params.searchId),
          eq(savedSearch.userId, params.userId),
        ),
      )
      .limit(1);
    if (!existing) return false;

    const existingFilters = parseSavedSearchFilters(existing.filters);
    const matchCriteriaChanged =
      !existingFilters.success ||
      savedSearchMatchCriteriaKey(existing.query, existingFilters.data) !==
        savedSearchMatchCriteriaKey(params.query, nextFilters.data);
    const emailChanged =
      params.emailAlertsEnabled !== undefined &&
      params.emailAlertsEnabled !== existing.emailAlertsEnabled;
    const discordChanged =
      params.discordAlertsEnabled !== undefined &&
      params.discordAlertsEnabled !== existing.discordAlertsEnabled;
    const updateWhere = and(
      eq(savedSearch.id, params.searchId),
      eq(savedSearch.userId, params.userId),
      eq(savedSearch.query, existing.query),
      eq(savedSearch.filters, existing.filters),
      eq(savedSearch.searchMatchVersion, existing.searchMatchVersion),
      eq(savedSearch.emailConfigVersion, existing.emailConfigVersion),
      eq(savedSearch.discordConfigVersion, existing.discordConfigVersion),
    );

    const now = new Date();
    const nextMatchVersion =
      existing.searchMatchVersion + (matchCriteriaChanged ? 1 : 0);
    const nextEmailVersion =
      existing.emailConfigVersion + (emailChanged ? 1 : 0);
    const nextDiscordVersion =
      existing.discordConfigVersion + (discordChanged ? 1 : 0);
    const publicationSequence = sql<number>`(
      select coalesce(max(${ingestionRun.publicationSequence}), 0)
      from ${ingestionRun}
    )`;
    const updatedSearchIds = params.database
      .select({ id: savedSearch.id })
      .from(savedSearch)
      .where(
        and(
          eq(savedSearch.id, params.searchId),
          eq(savedSearch.userId, params.userId),
          eq(savedSearch.searchMatchVersion, nextMatchVersion),
          eq(savedSearch.emailConfigVersion, nextEmailVersion),
          eq(savedSearch.discordConfigVersion, nextDiscordVersion),
          eq(savedSearch.query, params.query),
          eq(savedSearch.filters, params.filters),
        ),
      );
    const [updated] = await params.database.batch([
      params.database
        .update(savedSearch)
        .set({
          name: params.name,
          query: params.query,
          filters: params.filters,
          ...(matchCriteriaChanged
            ? {
                searchMatchVersion: nextMatchVersion,
                emailStartSequence: publicationSequence,
                discordStartSequence: publicationSequence,
                lastMatchedPublicationSequence: publicationSequence,
                lastCheckedAt: now,
                alertQuarantinedAt: null,
                alertQuarantineReason: null,
              }
            : {}),
          ...(emailChanged
            ? {
                emailAlertsEnabled: params.emailAlertsEnabled,
                emailConfigVersion: nextEmailVersion,
                ...(params.emailAlertsEnabled
                  ? { emailStartSequence: publicationSequence }
                  : {}),
              }
            : {}),
          ...(discordChanged
            ? {
                discordAlertsEnabled: params.discordAlertsEnabled,
                discordConfigVersion: nextDiscordVersion,
                ...(params.discordAlertsEnabled
                  ? { discordStartSequence: publicationSequence }
                  : {}),
              }
            : {}),
          ...(!existing.emailAlertsEnabled &&
          !existing.discordAlertsEnabled &&
          (params.emailAlertsEnabled || params.discordAlertsEnabled)
            ? { lastCheckedAt: now }
            : {}),
        })
        .where(updateWhere)
        .returning({ id: savedSearch.id }),
      params.database
        .update(searchNotificationIntent)
        .set({
          status: "cancelled",
          cancelledAt: now,
          claimToken: null,
        })
        .where(
          and(
            inArray(searchNotificationIntent.savedSearchId, updatedSearchIds),
            // A competing update may already have reached these versions.
            // Preserve intents created for the resulting configuration.
            or(
              matchCriteriaChanged
                ? ne(
                    searchNotificationIntent.searchMatchVersion,
                    nextMatchVersion,
                  )
                : undefined,
              emailChanged
                ? and(
                    eq(searchNotificationIntent.channel, "email"),
                    ne(
                      searchNotificationIntent.channelConfigVersion,
                      nextEmailVersion,
                    ),
                  )
                : undefined,
              discordChanged
                ? and(
                    eq(searchNotificationIntent.channel, "discord"),
                    ne(
                      searchNotificationIntent.channelConfigVersion,
                      nextDiscordVersion,
                    ),
                  )
                : undefined,
            ) ?? sql`false`,
            sql`${searchNotificationIntent.deliveredAt} is null`,
            sql`${searchNotificationIntent.cancelledAt} is null`,
          ),
        ),
    ]);
    if (updated.length === 1) return true;
  }

  throw new Error(
    `Saved search ${params.searchId} changed repeatedly during update. Retry the operation.`,
  );
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

export async function disableUserAlertChannels(params: {
  database: LibSQLDatabase;
  userId: string;
}): Promise<string[]> {
  const matchingSearchIds = params.database
    .select({ id: savedSearch.id })
    .from(savedSearch)
    .where(eq(savedSearch.userId, params.userId));
  const [updated] = await params.database.batch([
    params.database
      .update(savedSearch)
      .set({
        emailAlertsEnabled: false,
        discordAlertsEnabled: false,
        emailConfigVersion: sql`${savedSearch.emailConfigVersion} + 1`,
        discordConfigVersion: sql`${savedSearch.discordConfigVersion} + 1`,
      })
      .where(eq(savedSearch.userId, params.userId))
      .returning({ id: savedSearch.id }),
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
          inArray(searchNotificationIntent.channel, ["email", "discord"]),
          sql`${searchNotificationIntent.deliveredAt} is null`,
          sql`${searchNotificationIntent.cancelledAt} is null`,
        ),
      ),
  ]);
  return updated.map(({ id }) => id);
}
