/**
 * Dry-run simulation for alert cron behavior.
 *
 * Usage:
 *   bun scripts/dry-run-alerts.ts
 *
 * This script is READ-ONLY:
 * - Does NOT send email/Discord notifications
 * - Does NOT update lastCheckedAt
 * - Does NOT acquire/release processing locks
 *
 * It reports two passes:
 * 1) "now" pass using current lastCheckedAt (what cron would do right now)
 * 2) "next" pass using a simulated lastCheckedAt=now baseline
 */
import { and, desc, eq, gt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "~/lib/db";
import { savedSearch, vehicle } from "~/schema";

const filtersSchema = z.object({
  makes: z.array(z.string()).optional(),
  colors: z.array(z.string()).optional(),
  states: z.array(z.string()).optional(),
  salvageYards: z.array(z.string()).optional(),
  sources: z.array(z.string()).optional(),
  minYear: z.number().optional(),
  maxYear: z.number().optional(),
  sortBy: z.string().optional(),
});

type ParsedFilters = z.infer<typeof filtersSchema>;

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

function buildWhereClause(
  searchQuery: string,
  filters: ParsedFilters,
  lastCheckedAt: Date | null,
): SQL | undefined {
  const conditions: (SQL | undefined)[] = [];

  if (lastCheckedAt) {
    conditions.push(gt(vehicle.firstSeenAt, lastCheckedAt));
  }

  if (searchQuery.trim()) {
    const words = searchQuery.trim().toLowerCase().split(/\s+/);
    for (const word of words) {
      const wordCondition = or(
        sql`lower(${vehicle.make}) LIKE ${`%${word}%`}`,
        sql`lower(${vehicle.model}) LIKE ${`%${word}%`}`,
        sql`CAST(${vehicle.year} AS TEXT) LIKE ${`%${word}%`}`,
      );
      if (wordCondition) conditions.push(wordCondition);
    }
  }

  if (filters.makes && filters.makes.length > 0) {
    conditions.push(
      sql`lower(${vehicle.make}) IN (${sql.join(
        filters.makes.map((m) => sql`${m.toLowerCase()}`),
        sql`, `,
      )})`,
    );
  }

  if (filters.colors && filters.colors.length > 0) {
    conditions.push(
      sql`lower(${vehicle.color}) IN (${sql.join(
        filters.colors.map((c) => sql`${c.toLowerCase()}`),
        sql`, `,
      )})`,
    );
  }

  if (filters.states && filters.states.length > 0) {
    conditions.push(
      sql`lower(${vehicle.state}) IN (${sql.join(
        filters.states.map((s) => sql`${s.toLowerCase()}`),
        sql`, `,
      )})`,
    );
  }

  if (filters.salvageYards && filters.salvageYards.length > 0) {
    conditions.push(
      sql`lower(${vehicle.locationName}) IN (${sql.join(
        filters.salvageYards.map((y) => sql`${y.toLowerCase()}`),
        sql`, `,
      )})`,
    );
  }

  if (filters.sources && filters.sources.length > 0) {
    const validSources = filters.sources.filter(
      (s): s is "pyp" | "row52" => s === "pyp" || s === "row52",
    );
    if (validSources.length > 0) {
      conditions.push(
        sql`${vehicle.source} IN (${sql.join(
          validSources.map((s) => sql`${s}`),
          sql`, `,
        )})`,
      );
    }
  }

  if (filters.minYear) {
    conditions.push(sql`${vehicle.year} >= ${filters.minYear}`);
  }
  if (filters.maxYear) {
    conditions.push(sql`${vehicle.year} <= ${filters.maxYear}`);
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

async function getMatchStats(
  searchQuery: string,
  filters: ParsedFilters,
  lastCheckedAt: Date | null,
): Promise<{ fullCount: number; sampleCount: number; sampleVins: string[] }> {
  const whereClause = buildWhereClause(searchQuery, filters, lastCheckedAt);

  const countRows = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(vehicle)
    .where(whereClause);
  const fullCount = countRows[0]?.count ?? 0;

  const sampleRows = await db
    .select({ vin: vehicle.vin })
    .from(vehicle)
    .where(whereClause)
    .orderBy(desc(vehicle.firstSeenAt))
    .limit(100);

  return {
    fullCount,
    sampleCount: sampleRows.length,
    sampleVins: sampleRows.slice(0, 5).map((row) => row.vin),
  };
}

async function main() {
  await import("dotenv/config");

  const now = new Date();
  const searches = await db
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
      or(
        eq(savedSearch.emailAlertsEnabled, true),
        eq(savedSearch.discordAlertsEnabled, true),
      ),
    );

  console.log(
    `[dry-run-alerts] Loaded ${searches.length} alert-enabled searches at ${now.toISOString()}`,
  );

  let notifyNowCount = 0;
  let notifyNextCount = 0;
  let firstCheckCount = 0;

  const highSignalRows: string[] = [];

  for (const search of searches as SearchWithAlerts[]) {
    let parsedFilters: ParsedFilters;
    try {
      parsedFilters = filtersSchema.parse(JSON.parse(search.filters));
    } catch {
      highSignalRows.push(
        `- ${search.id} "${search.query}" -> invalid_filters (skipped)`,
      );
      continue;
    }

    if (!search.lastCheckedAt) {
      firstCheckCount += 1;
      highSignalRows.push(
        `- ${search.id} "${search.query}" -> first_check_baseline_set (would NOT notify)`,
      );
      continue;
    }

    const nowPass = await getMatchStats(
      search.query,
      parsedFilters,
      search.lastCheckedAt,
    );
    const nextPass = await getMatchStats(search.query, parsedFilters, now);

    const wouldNotifyNow = nowPass.sampleCount > 0;
    const wouldNotifyNext = nextPass.sampleCount > 0;
    if (wouldNotifyNow) notifyNowCount += 1;
    if (wouldNotifyNext) notifyNextCount += 1;

    if (wouldNotifyNow || wouldNotifyNext || nowPass.fullCount >= 50) {
      highSignalRows.push(
        [
          `- ${search.id} "${search.query}"`,
          `  now: notify=${wouldNotifyNow} sample=${nowPass.sampleCount} full=${nowPass.fullCount}`,
          `  next: notify=${wouldNotifyNext} sample=${nextPass.sampleCount} full=${nextPass.fullCount}`,
          `  sample VINs now: ${nowPass.sampleVins.join(", ") || "(none)"}`,
        ].join("\n"),
      );
    }
  }

  console.log("\n=== DRY RUN SUMMARY ===");
  console.log(`searches_total: ${searches.length}`);
  console.log(`searches_first_check_baseline_set: ${firstCheckCount}`);
  console.log(`searches_would_notify_now: ${notifyNowCount}`);
  console.log(`searches_would_notify_next_run: ${notifyNextCount}`);

  console.log("\n=== HIGH SIGNAL SEARCHES ===");
  if (highSignalRows.length === 0) {
    console.log("(none)");
  } else {
    for (const row of highSignalRows) {
      console.log(row);
    }
  }
}

main().catch((error) => {
  console.error("[dry-run-alerts] failed:", error);
  process.exitCode = 1;
});

