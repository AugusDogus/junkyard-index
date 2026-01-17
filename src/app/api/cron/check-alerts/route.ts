import * as Sentry from "@sentry/nextjs";
import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { env } from "~/env";
import { polarClient } from "~/lib/auth";
import { db } from "~/lib/db";
import { sendEmailAlert } from "~/lib/email";
import { buildSearchUrl } from "~/lib/search-utils";
import { savedSearch, user } from "~/schema";
import { appRouter } from "~/server/api/root";
import { filtersSchema } from "~/server/api/routers/savedSearches";
import { createCallerFactory, createTRPCContext } from "~/server/api/trpc";

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
}

async function processSearch(
  search: {
    id: string;
    userId: string;
    name: string;
    query: string;
    filters: string;
    lastCheckedAt: Date | null;
    lastVehicleIds: string | null;
  },
  userEmail: string
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

  // Get current vehicle IDs from filtered results
  const currentVehicleIds = filteredVehicles.map((v) => v.id);

  // Parse and validate previously stored vehicle IDs
  let previousVehicleIds: string[] = [];
  if (search.lastVehicleIds) {
    const idsParseResult = vehicleIdsSchema.safeParse(JSON.parse(search.lastVehicleIds));
    if (idsParseResult.success) {
      previousVehicleIds = idsParseResult.data;
    }
  }

  // Create a Set for O(1) lookup of previous IDs
  const previousIdsSet = new Set(previousVehicleIds);

  // Find vehicles that are in current results but weren't in previous results
  const newVehicleIds = currentVehicleIds.filter((id) => !previousIdsSet.has(id));
  const newVehicles = filteredVehicles.filter((v) => newVehicleIds.includes(v.id));

  // If this is the first check, just store the IDs without sending email
  if (previousVehicleIds.length === 0) {
    await db
      .update(savedSearch)
      .set({
        lastCheckedAt: new Date(),
        lastVehicleIds: JSON.stringify(currentVehicleIds),
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
        lastVehicleIds: JSON.stringify(currentVehicleIds),
      })
      .where(eq(savedSearch.id, search.id));

    return { searchId: search.id, status: "no_new_vehicles" };
  }

  // Build the search URL
  const searchUrl = `${env.NEXT_PUBLIC_APP_URL}${buildSearchUrl(search.query, filters)}`;

  // Send email alert with only the NEW vehicles
  const emailResult = await sendEmailAlert(userEmail, {
    searchName: search.name,
    query: search.query,
    newVehicles,
    searchUrl,
    searchId: search.id,
  });

  // Update the stored vehicle IDs regardless of email success
  await db
    .update(savedSearch)
    .set({
      lastCheckedAt: new Date(),
      lastVehicleIds: JSON.stringify(currentVehicleIds),
    })
    .where(eq(savedSearch.id, search.id));

  if (emailResult.success) {
    return {
      searchId: search.id,
      status: "email_sent",
      newVehicles: newVehicles.length,
    };
  } else {
    return {
      searchId: search.id,
      status: `email_failed: ${emailResult.error}`,
      newVehicles: newVehicles.length,
    };
  }
}

export async function GET(request: NextRequest) {
  // Verify the request is from Vercel Cron
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Get all saved searches with email alerts enabled
    const searchesWithAlerts = await db
      .select({
        id: savedSearch.id,
        userId: savedSearch.userId,
        name: savedSearch.name,
        query: savedSearch.query,
        filters: savedSearch.filters,
        lastCheckedAt: savedSearch.lastCheckedAt,
        lastVehicleIds: savedSearch.lastVehicleIds,
      })
      .from(savedSearch)
      .where(eq(savedSearch.emailAlertsEnabled, true));

    if (searchesWithAlerts.length === 0) {
      return NextResponse.json({ message: "No searches with alerts enabled" });
    }

    console.log(`Processing ${searchesWithAlerts.length} searches with alerts enabled`);

    const results: SearchResult[] = [];

    // Process searches in batches for efficient parallel execution
    for (let i = 0; i < searchesWithAlerts.length; i += BATCH_SIZE) {
      const batch = searchesWithAlerts.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.all(
        batch.map(async (search) => {
          try {
            // Get user email
            const userRecord = await db
              .select({ email: user.email })
              .from(user)
              .where(eq(user.id, search.userId))
              .limit(1);

            const userEmail = userRecord[0]?.email;
            if (!userEmail) {
              console.warn(`No email found for user ${search.userId}, search ${search.id}`);
              return { searchId: search.id, status: "no_user_email" };
            }

            // Verify user still has an active subscription
            // (Webhook should disable alerts on cancellation, but double-check)
            try {
              const customerState = await polarClient.customers.getStateExternal({
                externalId: search.userId,
              });
              if (customerState.activeSubscriptions.length === 0) {
                // Auto-disable alerts for this user
                await db
                  .update(savedSearch)
                  .set({ emailAlertsEnabled: false })
                  .where(eq(savedSearch.id, search.id));
                return { searchId: search.id, status: "subscription_expired_disabled" };
              }
            } catch {
              // Customer not found in Polar - disable alerts
              await db
                .update(savedSearch)
                .set({ emailAlertsEnabled: false })
                .where(eq(savedSearch.id, search.id));
              return { searchId: search.id, status: "no_subscription_disabled" };
            }

            return await processSearch(search, userEmail);
          } catch (error) {
            console.error(`Error processing search ${search.id}:`, error);
            Sentry.captureException(error, {
              tags: { searchId: search.id, userId: search.userId },
            });
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
