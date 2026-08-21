import * as Sentry from "@sentry/nextjs";
import { eq, or } from "drizzle-orm";
import pLimit from "p-limit";
import { getAlertMatchStats } from "~/lib/algolia-alert-search";
import { polarClient } from "~/lib/auth";
import { db } from "~/lib/db";
import { sendDiscordAlert } from "~/lib/discord";
import { sendEmailDigest } from "~/lib/email";
import posthog from "~/lib/posthog-server";
import { SearchAlertMatch } from "~/lib/search-alert-data";
import { parseSavedSearchFilters } from "~/lib/saved-search-filters";
import { buildSearchUrl } from "~/lib/search-utils";
import { env } from "~/env";
import { savedSearch, user } from "~/schema";
import {
  createSearchNotificationDeliverySession,
  type PreparedSearchNotification,
} from "./deliver-search-notifications";
import {
  claimUserSearchGroups,
  processUserSearches,
  type AlertSubscriptionState,
  type PreparedSearchBatch,
  type UserSearchProcessingDependencies,
} from "./process-user-searches";
import {
  createSearchAlertClaimRepository,
  type SearchWithAlerts,
} from "./search-alert-claim-repository";
import {
  SearchAlertResult,
  type SearchAlertCompletion,
} from "./search-alert-result";

export type { SearchAlertResult } from "./search-alert-result";

export {
  parseSavedSearchFilters,
  type SavedSearchFiltersParseResult,
} from "~/lib/saved-search-filters";

// Lock timeout in milliseconds (5 minutes)
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

// Process users in batches for efficient parallel execution.
const USER_BATCH_SIZE = 5;
const SEARCH_TASK_CONCURRENCY = 5;
const SEARCH_PREPARATION_BATCH_SIZE = 5;

type RunSearchTask = <T>(task: () => Promise<T>) => Promise<T>;

const searchAlertClaims = createSearchAlertClaimRepository(db);

type SearchPreparationResult =
  | { kind: "complete"; result: SearchAlertResult }
  | { kind: "notification"; notification: PreparedSearchNotification };

export interface RunSearchAlertsResult {
  message: string;
  selected: number;
  processed: number;
  results: SearchAlertResult[];
}

async function prepareSearch(
  search: SearchWithAlerts,
): Promise<SearchPreparationResult> {
  const filtersParseResult = parseSavedSearchFilters(search.filters);
  if (!filtersParseResult.success) {
    if (filtersParseResult.reason === "malformed_json") {
      console.error(
        `Malformed JSON for search ${search.id}:`,
        filtersParseResult.error,
      );
    } else {
      console.error(
        `Invalid filters for search ${search.id}:`,
        filtersParseResult.error,
      );
    }

    return {
      kind: "complete",
      result: SearchAlertResult.completed(search.id, "invalid_filters"),
    };
  }
  const filters = filtersParseResult.data;

  if (!search.lastCheckedAt) {
    await db
      .update(savedSearch)
      .set({ lastCheckedAt: new Date() })
      .where(eq(savedSearch.id, search.id));
    return {
      kind: "complete",
      result: SearchAlertResult.completed(
        search.id,
        "first_check_baseline_set",
      ),
    };
  }

  const queryTime = new Date();
  const { vehicles, scannedCount, matchedCount, fullCount } =
    await getAlertMatchStats(search.query, filters, search.lastCheckedAt);
  const canAdvanceLastCheckedAt = scannedCount === fullCount;

  if (matchedCount === 0 && canAdvanceLastCheckedAt) {
    await db
      .update(savedSearch)
      .set({ lastCheckedAt: queryTime })
      .where(eq(savedSearch.id, search.id));
    return {
      kind: "complete",
      result: SearchAlertResult.completed(search.id, "no_new_vehicles"),
    };
  }
  if (matchedCount === 0) {
    return {
      kind: "complete",
      result: SearchAlertResult.completed(
        search.id,
        "no_new_vehicles_partial_scan",
      ),
    };
  }

  const searchUrl = `${env.NEXT_PUBLIC_APP_URL}${buildSearchUrl(search.query, filters)}`;
  return {
    kind: "notification",
    notification: {
      emailAlertsEnabled: search.emailAlertsEnabled,
      discordAlertsEnabled: search.discordAlertsEnabled,
      queryTime,
      canAdvanceLastCheckedAt,
      alertData: {
        searchName: search.name,
        query: search.query,
        match: SearchAlertMatch.create(matchedCount, vehicles),
        searchUrl,
        searchId: search.id,
      },
    },
  };
}

async function getAlertSubscriptionState(
  userId: string,
): Promise<AlertSubscriptionState> {
  try {
    const customerState = await polarClient.customers.getStateExternal({
      externalId: userId,
    });
    return customerState.activeSubscriptions.length > 0
      ? { kind: "active" }
      : { kind: "inactive", reason: "expired" };
  } catch (error) {
    const statusCode =
      error !== null &&
      error !== undefined &&
      typeof error === "object" &&
      "statusCode" in error
        ? error.statusCode
        : undefined;
    if (statusCode === 404) {
      return { kind: "inactive", reason: "missing" };
    }
    console.error(
      `Transient Polar error for user ${userId}, will retry:`,
      error,
    );
    Sentry.captureException(error, {
      tags: { userId, context: "polar-subscription-check" },
    });
    return { kind: "unavailable", error };
  }
}

async function disableAlertsForInactiveSubscription(
  userId: string,
  searches: [SearchWithAlerts, ...SearchWithAlerts[]],
  reason: "expired" | "missing",
): Promise<SearchAlertResult[]> {
  const outcome: { event: string; completion: SearchAlertCompletion } =
    reason === "expired"
      ? {
          event: "alert_subscription_expired",
          completion: "subscription_expired_disabled",
        }
      : {
          event: "alert_no_subscription_disabled",
          completion: "no_subscription_disabled",
        };

  await db
    .update(savedSearch)
    .set({
      emailAlertsEnabled: false,
      discordAlertsEnabled: false,
    })
    .where(eq(savedSearch.userId, userId));

  for (const search of searches) {
    posthog.capture({
      distinctId: userId,
      event: outcome.event,
      properties: { search_id: search.id },
    });
  }

  return searches.map((search) =>
    SearchAlertResult.completed(search.id, outcome.completion),
  );
}

async function prepareSearchBatch(
  searches: SearchWithAlerts[],
  userId: string,
  runSearchTask: RunSearchTask,
): Promise<PreparedSearchBatch> {
  const preparationBatch = await Promise.all(
    searches.map((search) =>
      runSearchTask(async (): Promise<SearchPreparationResult> => {
        try {
          return await prepareSearch(search);
        } catch (error) {
          console.error(`Error preparing search ${search.id}:`, error);
          Sentry.captureException(error, {
            tags: { searchId: search.id, userId },
          });
          return {
            kind: "complete",
            result: SearchAlertResult.error(
              search.id,
              error instanceof Error ? error.message : "Unknown error",
            ),
          };
        }
      }),
    ),
  );

  const results: SearchAlertResult[] = [];
  const notifications: PreparedSearchNotification[] = [];
  for (const preparation of preparationBatch) {
    if (preparation.kind === "complete") {
      results.push(preparation.result);
    } else {
      notifications.push(preparation.notification);
    }
  }
  return { results, notifications };
}

function createUserSearchProcessingDependencies(
  runSearchTask: RunSearchTask,
): UserSearchProcessingDependencies {
  return {
    preparationBatchSize: SEARCH_PREPARATION_BATCH_SIZE,
    loadUserInfo: async (userId) => {
      const [userInfo] = await db
        .select({
          email: user.email,
          discordId: user.discordId,
          discordAppInstalled: user.discordAppInstalled,
        })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);
      return userInfo ?? null;
    },
    getSubscriptionState: getAlertSubscriptionState,
    disableAlertsForInactiveSubscription,
    prepareSearchBatch: (searches, userId) =>
      prepareSearchBatch(searches, userId, runSearchTask),
    createDeliverySession: (target) =>
      createSearchNotificationDeliverySession(target, {
        sendEmailDigest,
        sendDiscordAlert,
        advanceLastCheckedAt: async (searchId, checkedAt) => {
          try {
            await db
              .update(savedSearch)
              .set({ lastCheckedAt: checkedAt })
              .where(eq(savedSearch.id, searchId));
          } catch (error) {
            console.error(
              `Failed to persist alert checkpoint for search ${searchId}:`,
              error,
            );
            Sentry.captureException(error, {
              tags: {
                searchId,
                userId: target.userId,
                context: "alert-checkpoint-persistence",
              },
            });
            throw error;
          }
        },
        captureNotification: ({
          userId,
          searchId,
          newVehicleCount,
          emailSent,
          discordSent,
        }) => {
          posthog.capture({
            distinctId: userId,
            event: "alert_notification_sent",
            properties: {
              search_id: searchId,
              new_vehicle_count: newVehicleCount,
              email_sent: emailSent,
              discord_sent: discordSent,
            },
          });
        },
        runSearchTask,
      }),
    releaseClaim: (userId, lockTime) =>
      searchAlertClaims.releaseUserSearchClaim(userId, lockTime),
    reportProcessingFailure: (userId, searchIds, error) => {
      console.error(`Error processing alerts for user ${userId}:`, error);
      Sentry.captureException(error, {
        tags: { userId, context: "user-alert-batch" },
        extra: { searchIds },
      });
    },
    reportReleaseFailure: (userId, searchIds, error) => {
      console.error(`Failed to release alert claim for user ${userId}:`, error);
      Sentry.captureException(error, {
        tags: { userId, context: "user-search-claim-release" },
        extra: { searchIds },
      });
    },
  };
}

export async function runSearchAlerts(
  source: string,
): Promise<RunSearchAlertsResult> {
  const staleLockThreshold = new Date(Date.now() - LOCK_TIMEOUT_MS);

  const selectedSearches = await db
    .select({
      id: savedSearch.id,
      userId: savedSearch.userId,
    })
    .from(savedSearch)
    .where(
      or(
        eq(savedSearch.emailAlertsEnabled, true),
        eq(savedSearch.discordAlertsEnabled, true),
      ),
    );

  if (selectedSearches.length === 0) {
    return {
      message: "No searches with alerts enabled",
      selected: 0,
      processed: 0,
      results: [],
    };
  }

  console.log(
    `Processing ${selectedSearches.length} searches with alerts enabled`,
  );

  const results: SearchAlertResult[] = [];
  const userIds = [...new Set(selectedSearches.map((search) => search.userId))];
  const searchLimit = pLimit(SEARCH_TASK_CONCURRENCY);
  const runSearchTask: RunSearchTask = (task) => searchLimit(task);
  const processingDependencies =
    createUserSearchProcessingDependencies(runSearchTask);

  for (let i = 0; i < userIds.length; i += USER_BATCH_SIZE) {
    const batch = userIds.slice(i, i + USER_BATCH_SIZE);
    const claimedGroups = await claimUserSearchGroups(
      batch,
      staleLockThreshold,
      (userId, threshold) =>
        searchAlertClaims.claimUserSearches(userId, threshold),
      (userId, error) => {
        console.error(`Failed to claim searches for user ${userId}:`, error);
        Sentry.captureException(error, {
          tags: { userId, context: "user-search-claim" },
        });
      },
    );

    const batchResults = await Promise.all(
      claimedGroups.map(({ searches, lockTime }) =>
        processUserSearches(searches, lockTime, processingDependencies),
      ),
    );

    results.push(...batchResults.flat());
  }

  const notificationsSent = results.filter(
    SearchAlertResult.notificationSent,
  ).length;
  const errored = results.filter(SearchAlertResult.hasError).length;
  posthog.capture({
    distinctId: "system",
    event: "alert_cron_completed",
    properties: {
      source,
      total_selected: selectedSearches.length,
      total_processed: results.length,
      notifications_sent: notificationsSent,
      errors: errored,
    },
  });
  await posthog.shutdown();

  return {
    message: "Alert check completed",
    selected: selectedSearches.length,
    processed: results.length,
    results,
  };
}
