import * as Sentry from "@sentry/nextjs";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { getAlertMatchStats } from "~/lib/algolia-alert-search";
import { polarClient } from "~/lib/auth";
import { db } from "~/lib/db";
import { sendDiscordAlert } from "~/lib/discord";
import { sendEmailAlert } from "~/lib/email";
import posthog from "~/lib/posthog-server";
import { filtersSchema } from "~/lib/saved-search-filters";
import { buildSearchUrl } from "~/lib/search-utils";
import type { Vehicle } from "~/lib/types";
import { env } from "~/env";
import { savedSearch, user } from "~/schema";

// Lock timeout in milliseconds (5 minutes)
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

// Process searches in batches for efficient parallel execution
const BATCH_SIZE = 5;

export interface SearchAlertResult {
  searchId: string;
  status: string;
  newVehicles?: number;
  emailSent?: boolean;
  discordSent?: boolean;
}

interface UserInfo {
  email: string;
  discordId: string | null;
  discordAppInstalled: boolean;
}

interface SearchWithAlerts {
  id: string;
  userId: string;
  name: string;
  query: string;
  filters: string;
  lastCheckedAt: Date | null;
  emailAlertsEnabled: boolean;
  discordAlertsEnabled: boolean;
}

export interface RunSearchAlertsResult {
  message: string;
  selected: number;
  processed: number;
  results: SearchAlertResult[];
}

type SavedSearchFiltersParseResult =
  | {
      success: true;
      data: z.infer<typeof filtersSchema>;
    }
  | {
      success: false;
      reason: "malformed_json";
      error: SyntaxError;
    }
  | {
      success: false;
      reason: "invalid_schema";
      error: z.ZodError<z.infer<typeof filtersSchema>>;
    };

export function parseSavedSearchFilters(
  rawFiltersJson: string,
): SavedSearchFiltersParseResult {
  let rawFilters: unknown;
  try {
    rawFilters = JSON.parse(rawFiltersJson);
  } catch (error) {
    return {
      success: false,
      reason: "malformed_json",
      error:
        error instanceof SyntaxError
          ? error
          : new SyntaxError(String(error)),
    };
  }

  const filtersParseResult = filtersSchema.safeParse(rawFilters);
  if (filtersParseResult.success) {
    return filtersParseResult;
  }

  return {
    success: false,
    reason: "invalid_schema",
    error: filtersParseResult.error,
  };
}

export function buildAlertResultStatus(params: {
  emailSent: boolean;
  discordSent: boolean;
  errors: string[];
  canAdvanceLastCheckedAt: boolean;
}): string {
  const statusParts: string[] = [];
  if (params.errors.length > 0) {
    statusParts.push(`error: ${params.errors.join("; ")}`);
  }
  if (params.emailSent) statusParts.push("email_sent");
  if (params.discordSent) statusParts.push("discord_sent");
  if (statusParts.length === 0) statusParts.push("no_notifications_sent");
  if (!params.canAdvanceLastCheckedAt) {
    statusParts.push("last_checked_not_advanced");
  } else if (params.errors.length > 0) {
    statusParts.push("last_checked_not_advanced_due_delivery_errors");
  }

  return statusParts.join(", ");
}

async function findNewVehicles(
  search: SearchWithAlerts,
  filters: z.infer<typeof filtersSchema>,
): Promise<{ vehicles: Vehicle[]; fullCount: number }> {
  const { vehicles, fullCount } = await getAlertMatchStats(
    search.query,
    filters,
    search.lastCheckedAt,
  );
  return { vehicles, fullCount };
}

async function sendNotifications(
  search: SearchWithAlerts,
  userInfo: UserInfo,
  newVehicles: Vehicle[],
  searchUrl: string,
): Promise<{ emailSent: boolean; discordSent: boolean; errors: string[] }> {
  const errors: string[] = [];
  let emailSent = false;
  let discordSent = false;

  const alertData = {
    searchName: search.name,
    query: search.query,
    newVehicles,
    searchUrl,
    searchId: search.id,
  };

  if (search.emailAlertsEnabled) {
    const emailResult = await sendEmailAlert(userInfo.email, alertData);
    if (emailResult.success) {
      emailSent = true;
    } else {
      errors.push(`Email failed: ${emailResult.error}`);
    }
  }

  if (search.discordAlertsEnabled) {
    if (!userInfo.discordId) {
      errors.push("Discord alerts enabled but user has no Discord ID linked");
    } else if (!userInfo.discordAppInstalled) {
      errors.push(
        "Discord alerts enabled but user has not installed the Discord app",
      );
    } else {
      const discordResult = await sendDiscordAlert(userInfo.discordId, alertData);
      if (discordResult.success) {
        discordSent = true;
      } else {
        errors.push(`Discord failed: ${discordResult.error}`);
      }
    }
  }

  return { emailSent, discordSent, errors };
}

async function processSearch(
  search: SearchWithAlerts,
  userInfo: UserInfo,
): Promise<SearchAlertResult> {
  const filtersParseResult = parseSavedSearchFilters(search.filters);
  if (!filtersParseResult.success) {
    if (filtersParseResult.reason === "malformed_json") {
      console.error(`Malformed JSON for search ${search.id}`);
    } else {
      console.error(
        `Invalid filters for search ${search.id}:`,
        filtersParseResult.error,
      );
    }

    return { searchId: search.id, status: "invalid_filters" };
  }
  const filters = filtersParseResult.data;

  if (!search.lastCheckedAt) {
    await db
      .update(savedSearch)
      .set({ lastCheckedAt: new Date() })
      .where(eq(savedSearch.id, search.id));
    return { searchId: search.id, status: "first_check_baseline_set" };
  }

  const queryTime = new Date();
  const { vehicles: newVehicles, fullCount } = await findNewVehicles(
    search,
    filters,
  );
  const canAdvanceLastCheckedAt = newVehicles.length === fullCount;

  if (newVehicles.length === 0 && canAdvanceLastCheckedAt) {
    await db
      .update(savedSearch)
      .set({ lastCheckedAt: queryTime })
      .where(eq(savedSearch.id, search.id));
    return { searchId: search.id, status: "no_new_vehicles" };
  }
  if (newVehicles.length === 0) {
    return { searchId: search.id, status: "no_new_vehicles_partial_scan" };
  }

  const searchUrl = `${env.NEXT_PUBLIC_APP_URL}${buildSearchUrl(search.query, filters)}`;
  const { emailSent, discordSent, errors } = await sendNotifications(
    search,
    userInfo,
    newVehicles,
    searchUrl,
  );

  /**
   * Advance checkpoint only when scan coverage is complete AND delivery had no
   * errors. This preserves retryability after transient provider failures.
   */
  const shouldAdvanceLastCheckedAt = canAdvanceLastCheckedAt && errors.length === 0;
  if (shouldAdvanceLastCheckedAt) {
    await db
      .update(savedSearch)
      .set({ lastCheckedAt: queryTime })
      .where(eq(savedSearch.id, search.id));
  }

  if (emailSent || discordSent) {
    posthog.capture({
      distinctId: search.userId,
      event: "alert_notification_sent",
      properties: {
        search_id: search.id,
        new_vehicle_count: newVehicles.length,
        email_sent: emailSent,
        discord_sent: discordSent,
      },
    });
  }

  return {
    searchId: search.id,
    status: buildAlertResultStatus({
      emailSent,
      discordSent,
      errors,
      canAdvanceLastCheckedAt,
    }),
    newVehicles: newVehicles.length,
    emailSent,
    discordSent,
  };
}

export async function runSearchAlerts(
  source: string,
): Promise<RunSearchAlertsResult> {
  const staleLockThreshold = new Date(Date.now() - LOCK_TIMEOUT_MS);

  const searchesWithAlerts = await db
    .select({
      id: savedSearch.id,
      userId: savedSearch.userId,
      name: savedSearch.name,
      query: savedSearch.query,
      filters: savedSearch.filters,
      lastCheckedAt: savedSearch.lastCheckedAt,
      emailAlertsEnabled: savedSearch.emailAlertsEnabled,
      discordAlertsEnabled: savedSearch.discordAlertsEnabled,
    })
    .from(savedSearch)
    .where(
      and(
        or(
          eq(savedSearch.emailAlertsEnabled, true),
          eq(savedSearch.discordAlertsEnabled, true),
        ),
        or(
          isNull(savedSearch.processingLock),
          lt(savedSearch.processingLock, staleLockThreshold),
        ),
      ),
    );

  if (searchesWithAlerts.length === 0) {
    return {
      message: "No searches with alerts enabled (or all are locked)",
      selected: 0,
      processed: 0,
      results: [],
    };
  }

  console.log(
    `Processing ${searchesWithAlerts.length} searches with alerts enabled`,
  );

  const results: SearchAlertResult[] = [];

  for (let i = 0; i < searchesWithAlerts.length; i += BATCH_SIZE) {
    const batch = searchesWithAlerts.slice(i, i + BATCH_SIZE);

    const lockedIds = new Set<string>();
    for (const s of batch) {
      const lockResult = await db
        .update(savedSearch)
        .set({ processingLock: new Date() })
        .where(
          and(
            eq(savedSearch.id, s.id),
            or(
              isNull(savedSearch.processingLock),
              lt(savedSearch.processingLock, staleLockThreshold),
            ),
          ),
        )
        .returning({ id: savedSearch.id });
      if (lockResult.length > 0) {
        lockedIds.add(s.id);
      }
    }
    const lockedBatch = batch.filter((s) => lockedIds.has(s.id));

    const batchResults = await Promise.all(
      lockedBatch.map(async (search) => {
        try {
          const [userInfo] = await db
            .select({
              email: user.email,
              discordId: user.discordId,
              discordAppInstalled: user.discordAppInstalled,
            })
            .from(user)
            .where(eq(user.id, search.userId))
            .limit(1);

          if (!userInfo?.email) {
            await db
              .update(savedSearch)
              .set({ processingLock: null })
              .where(eq(savedSearch.id, search.id));
            return { searchId: search.id, status: "no_user_email" };
          }

          try {
            const customerState = await polarClient.customers.getStateExternal({
              externalId: search.userId,
            });
            if (customerState.activeSubscriptions.length === 0) {
              await db
                .update(savedSearch)
                .set({
                  emailAlertsEnabled: false,
                  discordAlertsEnabled: false,
                  processingLock: null,
                })
                .where(eq(savedSearch.id, search.id));
              posthog.capture({
                distinctId: search.userId,
                event: "alert_subscription_expired",
                properties: { search_id: search.id },
              });
              return {
                searchId: search.id,
                status: "subscription_expired_disabled",
              };
            }
          } catch (polarError) {
            const statusCode =
              polarError !== null &&
              polarError !== undefined &&
              typeof polarError === "object" &&
              "statusCode" in polarError
                ? (polarError as { statusCode: unknown }).statusCode
                : undefined;
            const isNotFound = statusCode === 404;

            if (isNotFound) {
              await db
                .update(savedSearch)
                .set({
                  emailAlertsEnabled: false,
                  discordAlertsEnabled: false,
                  processingLock: null,
                })
                .where(eq(savedSearch.id, search.id));
              posthog.capture({
                distinctId: search.userId,
                event: "alert_no_subscription_disabled",
                properties: { search_id: search.id },
              });
              return {
                searchId: search.id,
                status: "no_subscription_disabled",
              };
            }

            console.error(
              `Transient Polar error for search ${search.id}, will retry:`,
              polarError,
            );
            Sentry.captureException(polarError, {
              tags: {
                searchId: search.id,
                userId: search.userId,
                context: "polar-subscription-check",
              },
            });
            await db
              .update(savedSearch)
              .set({ processingLock: null })
              .where(eq(savedSearch.id, search.id));
            return {
              searchId: search.id,
              status: "subscription_check_skipped_transient_error",
            };
          }

          const result = await processSearch(search, {
            email: userInfo.email,
            discordId: userInfo.discordId,
            discordAppInstalled: userInfo.discordAppInstalled,
          });

          await db
            .update(savedSearch)
            .set({ processingLock: null })
            .where(eq(savedSearch.id, search.id));

          return result;
        } catch (error) {
          console.error(`Error processing search ${search.id}:`, error);
          Sentry.captureException(error, {
            tags: { searchId: search.id, userId: search.userId },
          });
          await db
            .update(savedSearch)
            .set({ processingLock: null })
            .where(eq(savedSearch.id, search.id));
          return {
            searchId: search.id,
            status: `error: ${error instanceof Error ? error.message : "Unknown error"}`,
          };
        }
      }),
    );

    results.push(...batchResults);
  }

  const notificationsSent = results.filter(
    (r) => r.emailSent || r.discordSent,
  ).length;
  const errored = results.filter((r) => r.status.startsWith("error")).length;
  posthog.capture({
    distinctId: "system",
    event: "alert_cron_completed",
    properties: {
      source,
      total_selected: searchesWithAlerts.length,
      total_processed: results.length,
      notifications_sent: notificationsSent,
      errors: errored,
    },
  });
  await posthog.shutdown();

  return {
    message: "Alert check completed",
    selected: searchesWithAlerts.length,
    processed: results.length,
    results,
  };
}
