import * as Sentry from "@sentry/nextjs";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { env } from "~/env";
import { polarClient } from "~/lib/auth";
import { db } from "~/lib/db";
import { sendDiscordAlert } from "~/lib/discord";
import { sendEmailAlert } from "~/lib/email";
import { buildSearchUrl } from "~/lib/search-utils";
import type { Vehicle } from "~/lib/types";
import { savedSearch, user } from "~/schema";
import { appRouter } from "~/server/api/root";
import { filtersSchema } from "~/server/api/routers/savedSearches";
import { createCallerFactory, createTRPCContext } from "~/server/api/trpc";

// Lock timeout in milliseconds (5 minutes)
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

// Create a tRPC caller for server-side use
const createCaller = createCallerFactory(appRouter);

// Validation schema for stored vehicle IDs
const vehicleIdsSchema = z.array(z.string());

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
  lastVehicleIds: string | null;
  emailAlertsEnabled: boolean;
  discordAlertsEnabled: boolean;
}

function normalizeFingerprintPart(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Build a stable fingerprint for alert diffing.
 * This intentionally avoids relying on provider IDs because sources can change ID formats.
 */
function getVehicleFingerprint(vehicle: Vehicle): string {
  const source = normalizeFingerprintPart(vehicle.source);
  const locationCode = normalizeFingerprintPart(vehicle.location.locationCode);
  const year = vehicle.year.toString();
  const make = normalizeFingerprintPart(vehicle.make);
  const model = normalizeFingerprintPart(vehicle.model);
  const vin = normalizeFingerprintPart(vehicle.vin);
  const stockNumber = normalizeFingerprintPart(vehicle.stockNumber);
  const row = normalizeFingerprintPart(vehicle.yardLocation.row);
  const space = normalizeFingerprintPart(vehicle.yardLocation.space);

  if (vin) {
    return `${source}|vin:${vin}|loc:${locationCode}`;
  }

  if (stockNumber) {
    return `${source}|stock:${stockNumber}|loc:${locationCode}|${year}|${make}|${model}`;
  }

  return `${source}|loc:${locationCode}|${year}|${make}|${model}|row:${row}|space:${space}`;
}

function isLegacyVehicleState(entries: string[]): boolean {
  if (entries.length === 0) {
    return false;
  }

  // Legacy format stored raw source IDs; new format always contains pipe-delimited parts.
  return entries.every((entry) => !entry.includes("|"));
}

async function sendNotifications(
  search: SearchWithAlerts,
  userInfo: UserInfo,
  newVehicles: Vehicle[],
  searchUrl: string
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

  // Send email notification if enabled
  if (search.emailAlertsEnabled) {
    const emailResult = await sendEmailAlert(userInfo.email, alertData);
    if (emailResult.success) {
      emailSent = true;
    } else {
      errors.push(`Email failed: ${emailResult.error}`);
    }
  }

  // Send Discord notification if enabled and user has Discord set up
  if (search.discordAlertsEnabled) {
    if (!userInfo.discordId) {
      errors.push("Discord alerts enabled but user has no Discord ID linked");
    } else if (!userInfo.discordAppInstalled) {
      errors.push("Discord alerts enabled but user has not installed the Discord app");
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
  userInfo: UserInfo
): Promise<SearchResult> {
  // Parse and validate filters
  const filtersParseResult = filtersSchema.safeParse(JSON.parse(search.filters));
  if (!filtersParseResult.success) {
    console.error(`Invalid filters for search ${search.id}:`, filtersParseResult.error);
    return { searchId: search.id, status: "invalid_filters" };
  }
  const filters = filtersParseResult.data;

  // Create tRPC context and caller for server-side search
  const ctx = await createTRPCContext({ headers: new Headers() });
  const caller = createCaller(ctx);

  // Execute the search with filters supported by the API
  const searchResult = await caller.vehicles.search({
    query: search.query,
    makes: filters.makes,
    colors: filters.colors,
    states: filters.states,
    yearRange:
      filters.minYear && filters.maxYear ? [filters.minYear, filters.maxYear] : undefined,
  });

  // Apply salvageYards filter client-side (filters by location.name)
  const filteredVehicles = filters.salvageYards?.length
    ? searchResult.vehicles.filter((v) => filters.salvageYards!.includes(v.location.name))
    : searchResult.vehicles;

  // Build stable fingerprints so provider-side ID churn doesn't retrigger old inventory as "new"
  const currentVehicleFingerprints = filteredVehicles.map((v) => getVehicleFingerprint(v));

  // Parse and validate previously stored vehicle IDs
  let previousVehicleFingerprints: string[] = [];
  if (search.lastVehicleIds) {
    const idsParseResult = vehicleIdsSchema.safeParse(JSON.parse(search.lastVehicleIds));
    if (idsParseResult.success) {
      previousVehicleFingerprints = idsParseResult.data;
    }
  }

  // TODO(remove-legacy-alert-migration): Remove this branch once production has fully migrated.
  // Cron runs daily (08:00 UTC), and each successfully processed search migrates in one run.
  // Exit criteria:
  // 1) one successful post-deploy cron run completes
  // 2) DB check confirms no legacy lastVehicleIds entries remain
  // We baseline instead of diffing to prevent noisy false-positive alerts after deploy.
  if (isLegacyVehicleState(previousVehicleFingerprints)) {
    await db
      .update(savedSearch)
      .set({
        lastCheckedAt: new Date(),
        lastVehicleIds: JSON.stringify(currentVehicleFingerprints),
      })
      .where(eq(savedSearch.id, search.id));

    return { searchId: search.id, status: "legacy_baseline_migrated" };
  }

  // Create a Set for O(1) lookup of previous fingerprints
  const previousFingerprintsSet = new Set(previousVehicleFingerprints);

  // Find fingerprints in current results that weren't in previous results
  const newVehicleFingerprints = currentVehicleFingerprints.filter(
    (fingerprint) => !previousFingerprintsSet.has(fingerprint)
  );
  const newVehicleFingerprintsSet = new Set(newVehicleFingerprints);
  const newVehicles = filteredVehicles.filter((v) =>
    newVehicleFingerprintsSet.has(getVehicleFingerprint(v))
  );

  // If this is the first check, just store the IDs without sending notifications
  if (previousVehicleFingerprints.length === 0) {
    await db
      .update(savedSearch)
      .set({
        lastCheckedAt: new Date(),
        lastVehicleIds: JSON.stringify(currentVehicleFingerprints),
      })
      .where(eq(savedSearch.id, search.id));

    return { searchId: search.id, status: "first_check_baseline_set" };
  }

  // If no new vehicles, just update the timestamp and IDs
  if (newVehicles.length === 0) {
    await db
      .update(savedSearch)
      .set({
        lastCheckedAt: new Date(),
        lastVehicleIds: JSON.stringify(currentVehicleFingerprints),
      })
      .where(eq(savedSearch.id, search.id));

    return { searchId: search.id, status: "no_new_vehicles" };
  }

  // Build the search URL
  const searchUrl = `${env.NEXT_PUBLIC_APP_URL}${buildSearchUrl(search.query, filters)}`;

  // Send notifications (email and/or Discord)
  const { emailSent, discordSent, errors } = await sendNotifications(
    search,
    userInfo,
    newVehicles,
    searchUrl
  );

  // Update the stored vehicle IDs regardless of notification success
  await db
    .update(savedSearch)
    .set({
      lastCheckedAt: new Date(),
      lastVehicleIds: JSON.stringify(currentVehicleFingerprints),
    })
    .where(eq(savedSearch.id, search.id));

  // Build status message
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
  // Verify the request is from Vercel Cron
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Calculate stale lock threshold (locks older than 5 minutes are considered stale)
    const staleLockThreshold = new Date(Date.now() - LOCK_TIMEOUT_MS);

    // Get all saved searches with any alerts enabled that are not currently being processed
    // (processingLock is null OR processingLock is older than 5 minutes)
    const searchesWithAlerts = await db
      .select({
        id: savedSearch.id,
        userId: savedSearch.userId,
        name: savedSearch.name,
        query: savedSearch.query,
        filters: savedSearch.filters,
        lastCheckedAt: savedSearch.lastCheckedAt,
        lastVehicleIds: savedSearch.lastVehicleIds,
        emailAlertsEnabled: savedSearch.emailAlertsEnabled,
        discordAlertsEnabled: savedSearch.discordAlertsEnabled,
      })
      .from(savedSearch)
      .where(
        and(
          // Either email or discord alerts must be enabled
          or(
            eq(savedSearch.emailAlertsEnabled, true),
            eq(savedSearch.discordAlertsEnabled, true)
          ),
          // Not currently being processed (or lock is stale)
          or(
            isNull(savedSearch.processingLock),
            lt(savedSearch.processingLock, staleLockThreshold)
          )
        )
      );

    if (searchesWithAlerts.length === 0) {
      return NextResponse.json({ message: "No searches with alerts enabled (or all are locked)" });
    }

    console.log(`Processing ${searchesWithAlerts.length} searches with alerts enabled`);

    const results: SearchResult[] = [];

    // Process searches in batches for efficient parallel execution
    for (let i = 0; i < searchesWithAlerts.length; i += BATCH_SIZE) {
      const batch = searchesWithAlerts.slice(i, i + BATCH_SIZE);

      // Acquire locks for this batch
      const batchIds = batch.map((s) => s.id);
      for (const id of batchIds) {
        await db
          .update(savedSearch)
          .set({ processingLock: new Date() })
          .where(eq(savedSearch.id, id));
      }

      const batchResults = await Promise.all(
        batch.map(async (search) => {
          try {
            // Get user info including Discord details
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
              console.warn(`No email found for user ${search.userId}, search ${search.id}`);
              // Release lock
              await db
                .update(savedSearch)
                .set({ processingLock: null })
                .where(eq(savedSearch.id, search.id));
              return { searchId: search.id, status: "no_user_email" };
            }

            // Verify user still has an active subscription (required for notifications)
            // (Webhook should disable alerts on cancellation, but double-check)
            try {
              const customerState = await polarClient.customers.getStateExternal({
                externalId: search.userId,
              });
              if (customerState.activeSubscriptions.length === 0) {
                // Auto-disable alerts for this user and release lock
                await db
                  .update(savedSearch)
                  .set({
                    emailAlertsEnabled: false,
                    discordAlertsEnabled: false,
                    processingLock: null,
                  })
                  .where(eq(savedSearch.id, search.id));
                return { searchId: search.id, status: "subscription_expired_disabled" };
              }
            } catch {
              // Customer not found in Polar - disable alerts and release lock
              await db
                .update(savedSearch)
                .set({
                  emailAlertsEnabled: false,
                  discordAlertsEnabled: false,
                  processingLock: null,
                })
                .where(eq(savedSearch.id, search.id));
              return { searchId: search.id, status: "no_subscription_disabled" };
            }

            const result = await processSearch(search, {
              email: userInfo.email,
              discordId: userInfo.discordId,
              discordAppInstalled: userInfo.discordAppInstalled,
            });

            // Release lock after successful processing
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

            // Release lock on error
            await db
              .update(savedSearch)
              .set({ processingLock: null })
              .where(eq(savedSearch.id, search.id));

            return {
              searchId: search.id,
              status: `error: ${error instanceof Error ? error.message : "Unknown error"}`,
            };
          }
        })
      );

      results.push(...batchResults);
    }

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
      { status: 500 }
    );
  }
}
