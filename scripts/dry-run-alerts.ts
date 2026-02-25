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
import { eq, or } from "drizzle-orm";
import { z } from "zod";
import { getAlertMatchStats } from "~/lib/algolia-alert-search";
import { db } from "~/lib/db";
import { savedSearch } from "~/schema";

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

async function getMatchStats(
  searchQuery: string,
  filters: ParsedFilters,
  lastCheckedAt: Date | null,
): Promise<{ fullCount: number; sampleCount: number; sampleVins: string[] }> {
  const { fullCount, vehicles } = await getAlertMatchStats(
    searchQuery,
    filters,
    lastCheckedAt,
  );

  return {
    fullCount,
    sampleCount: vehicles.length,
    sampleVins: vehicles.slice(0, 5).map((row) => row.vin),
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

