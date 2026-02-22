import * as Sentry from "@sentry/nextjs";
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { env } from "~/env";
import { polarClient } from "~/lib/auth";
import { db } from "~/lib/db";
import { sendDiscordAlert } from "~/lib/discord";
import { sendEmailAlert } from "~/lib/email";
import posthog from "~/lib/posthog-server";
import { buildSearchUrl } from "~/lib/search-utils";
import type { Vehicle, DataSource } from "~/lib/types";
import { savedSearch, user, vehicle } from "~/schema";
import { filtersSchema } from "~/server/api/routers/savedSearches";

// Lock timeout in milliseconds (5 minutes)
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

// Process searches in batches for efficient parallel execution
const BATCH_SIZE = 5;

interface SearchResult {
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

/**
 * Map a vehicle DB row to the Vehicle type expected by email/Discord templates.
 */
function dbVehicleToVehicle(v: typeof vehicle.$inferSelect): Vehicle {
  return {
    id: v.vin,
    year: v.year,
    make: v.make,
    model: v.model,
    color: v.color ?? "",
    vin: v.vin,
    stockNumber: v.stockNumber ?? "",
    availableDate: v.availableDate ?? "",
    source: v.source as DataSource,
    location: {
      locationCode: v.locationCode,
      locationPageURL: "",
      name: v.locationName,
      displayName: v.locationName.replace(/^Pick Your Part - /, ""),
      address: "",
      city: "",
      state: v.state,
      stateAbbr: v.stateAbbr,
      zip: "",
      phone: "",
      lat: v.lat,
      lng: v.lng,
      distance: 0,
      legacyCode: "",
      primo: "",
      source: v.source as DataSource,
      urls: {
        store: "",
        interchange: "",
        inventory: "",
        prices: v.pricesUrl ?? "",
        directions: "",
        sellACar: "",
        contact: "",
        customerServiceChat: null,
        carbuyChat: null,
        deals: "",
        parts: v.partsUrl ?? "",
      },
    },
    yardLocation: {
      section: v.section ?? "",
      row: v.row ?? "",
      space: v.space ?? "",
    },
    images: v.imageUrl ? [{ url: v.imageUrl }] : [],
    detailsUrl: v.detailsUrl ?? "",
    partsUrl: v.partsUrl ?? "",
    pricesUrl: v.pricesUrl ?? "",
    engine: v.engine ?? undefined,
    trim: v.trim ?? undefined,
    transmission: v.transmission ?? undefined,
  };
}

/**
 * Query new vehicles from the canonical vehicle table matching a saved search's criteria.
 * Returns vehicles where firstSeenAt > lastCheckedAt.
 */
async function findNewVehicles(
  search: SearchWithAlerts,
  filters: z.infer<typeof filtersSchema>,
): Promise<Vehicle[]> {
  // Build WHERE conditions
  const conditions: ReturnType<typeof eq>[] = [];

  // Only vehicles seen since last check
  if (search.lastCheckedAt) {
    conditions.push(gt(vehicle.firstSeenAt, search.lastCheckedAt));
  }

  // Text query: split into words and match each against make, model, or year.
  // e.g. "Honda Civic" → word "honda" matches make, word "civic" matches model.
  if (search.query.trim()) {
    const words = search.query.trim().toLowerCase().split(/\s+/);
    for (const word of words) {
      conditions.push(
        or(
          sql`lower(${vehicle.make}) LIKE ${"%" + word + "%"}`,
          sql`lower(${vehicle.model}) LIKE ${"%" + word + "%"}`,
          sql`CAST(${vehicle.year} AS TEXT) LIKE ${"%" + word + "%"}`,
        )!,
      );
    }
  }

  // Make filter
  if (filters.makes && filters.makes.length > 0) {
    conditions.push(
      sql`lower(${vehicle.make}) IN (${sql.join(
        filters.makes.map((m) => sql`${m.toLowerCase()}`),
        sql`, `,
      )})`,
    );
  }

  // Color filter
  if (filters.colors && filters.colors.length > 0) {
    conditions.push(
      sql`lower(${vehicle.color}) IN (${sql.join(
        filters.colors.map((c) => sql`${c.toLowerCase()}`),
        sql`, `,
      )})`,
    );
  }

  // State filter
  if (filters.states && filters.states.length > 0) {
    conditions.push(
      sql`${vehicle.state} IN (${sql.join(
        filters.states.map((s) => sql`${s}`),
        sql`, `,
      )})`,
    );
  }

  // Salvage yards (location name) filter
  if (filters.salvageYards && filters.salvageYards.length > 0) {
    conditions.push(
      sql`${vehicle.locationName} IN (${sql.join(
        filters.salvageYards.map((y) => sql`${y}`),
        sql`, `,
      )})`,
    );
  }

  // Year range filter
  if (filters.minYear) {
    conditions.push(sql`${vehicle.year} >= ${filters.minYear}`);
  }
  if (filters.maxYear) {
    conditions.push(sql`${vehicle.year} <= ${filters.maxYear}`);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db.select().from(vehicle).where(whereClause).limit(100); // Cap alert results

  return rows.map(dbVehicleToVehicle);
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
      const discordResult = await sendDiscordAlert(
        userInfo.discordId,
        alertData,
      );
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
): Promise<SearchResult> {
  // Parse and validate filters
  const filtersParseResult = filtersSchema.safeParse(
    JSON.parse(search.filters),
  );
  if (!filtersParseResult.success) {
    console.error(
      `Invalid filters for search ${search.id}:`,
      filtersParseResult.error,
    );
    return { searchId: search.id, status: "invalid_filters" };
  }
  const filters = filtersParseResult.data;

  // If this is the first check (no lastCheckedAt), just set the baseline
  // without running the expensive findNewVehicles query
  if (!search.lastCheckedAt) {
    await db
      .update(savedSearch)
      .set({ lastCheckedAt: new Date() })
      .where(eq(savedSearch.id, search.id));
    return { searchId: search.id, status: "first_check_baseline_set" };
  }

  // Query new vehicles from canonical DB
  const newVehicles = await findNewVehicles(search, filters);

  // If no new vehicles, just update timestamp
  if (newVehicles.length === 0) {
    await db
      .update(savedSearch)
      .set({ lastCheckedAt: new Date() })
      .where(eq(savedSearch.id, search.id));
    return { searchId: search.id, status: "no_new_vehicles" };
  }

  // Build search URL and send notifications
  const searchUrl = `${env.NEXT_PUBLIC_APP_URL}${buildSearchUrl(search.query, filters)}`;
  const { emailSent, discordSent, errors } = await sendNotifications(
    search,
    userInfo,
    newVehicles,
    searchUrl,
  );

  // Update lastCheckedAt
  await db
    .update(savedSearch)
    .set({ lastCheckedAt: new Date() })
    .where(eq(savedSearch.id, search.id));

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

  const statusParts: string[] = [];
  if (emailSent) statusParts.push("email_sent");
  if (discordSent) statusParts.push("discord_sent");
  if (errors.length > 0) statusParts.push(`errors: ${errors.join("; ")}`);
  if (statusParts.length === 0) statusParts.push("no_notifications_sent");

  return {
    searchId: search.id,
    status: statusParts.join(", "),
    newVehicles: newVehicles.length,
    emailSent,
    discordSent,
  };
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
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
      return NextResponse.json({
        message: "No searches with alerts enabled (or all are locked)",
      });
    }

    console.log(
      `Processing ${searchesWithAlerts.length} searches with alerts enabled`,
    );

    const results: SearchResult[] = [];

    for (let i = 0; i < searchesWithAlerts.length; i += BATCH_SIZE) {
      const batch = searchesWithAlerts.slice(i, i + BATCH_SIZE);

      // Acquire locks atomically — only lock if not already locked
      for (const s of batch) {
        await db
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
          );
      }

      const batchResults = await Promise.all(
        batch.map(async (search) => {
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

            // Verify subscription
            try {
              const customerState =
                await polarClient.customers.getStateExternal({
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
            } catch {
              await db
                .update(savedSearch)
                .set({
                  emailAlertsEnabled: false,
                  discordAlertsEnabled: false,
                  processingLock: null,
                })
                .where(eq(savedSearch.id, search.id));
              return {
                searchId: search.id,
                status: "no_subscription_disabled",
              };
            }

            const result = await processSearch(search, {
              email: userInfo.email,
              discordId: userInfo.discordId,
              discordAppInstalled: userInfo.discordAppInstalled,
            });

            // Release lock
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
        total_processed: searchesWithAlerts.length,
        notifications_sent: notificationsSent,
        errors: errored,
      },
    });

    return NextResponse.json({
      message: "Cron job completed",
      processed: searchesWithAlerts.length,
      results,
    });
  } catch (error) {
    console.error("Cron job failed:", error);
    Sentry.captureException(error, { tags: { context: "cron-check-alerts" } });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
