import { Data, Duration } from "effect";
import { and, eq, gte } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { INGESTION_SOURCE_DISPLAY_NAMES } from "~/lib/ingestion-source";
import { kernelBrowserUsage } from "~/schema";
import type { BrowserSessions } from "./document-transport";
import {
  KERNEL_SESSION_TIMEOUT_SECONDS,
  KernelSessions,
  type KernelBrowserMode,
  type KernelSource,
} from "./kernel-sessions";
import { PROVIDER_CHUNK_WALL_LIMIT } from "./provider-chunk-clock";

/** Kernel's price per browser-second (November 2026): $0.06 an hour
 * headless, $0.48 an hour headful. */
export const KERNEL_USD_PER_SECOND: Readonly<
  Record<KernelBrowserMode, number>
> = {
  headless: 0.06 / 3_600,
  headful: 0.48 / 3_600,
};

/**
 * Month-to-date Kernel spend at which a source's chunks stop opening
 * browsers, by source. The organization's $5 monthly credit is shared with
 * Big D and Northwest (about $0.66 a month together), so U Pull R Parts may
 * spend at most $3.50 of it, whatever its crawls cost.
 */
export const KERNEL_MONTHLY_BUDGET_USD = {
  upullrparts: 3.5,
} as const satisfies Partial<Record<KernelSource, number>>;
export type MeteredKernelSource = keyof typeof KERNEL_MONTHLY_BUDGET_USD;

/**
 * UTC-day Kernel spend at which a source's chunks stop opening browsers. A
 * full U Pull R Parts crawl costs about $0.02 to $0.03, so $0.25 allows every
 * retry a bad day needs, while a crawl stuck failing cannot spend the month's
 * budget in a few days.
 */
export const KERNEL_DAILY_BUDGET_USD = {
  upullrparts: 0.25,
} as const satisfies Record<MeteredKernelSource, number>;

/** The longest a chunk's browser can bill: the chunk ends within its wall
 * limit, and Kernel deletes a browser whose delete failed this long after its
 * CDP connection closed. A row the process never closed counts this long. */
const MAX_BROWSER_MS =
  Duration.toMillis(PROVIDER_CHUNK_WALL_LIMIT) +
  KERNEL_SESSION_TIMEOUT_SECONDS * 1_000;

/** The source's Kernel spend this UTC day or month reached that period's
 * cap, so no browser was opened. */
export class KernelBudgetSpent extends Data.TaggedError("KernelBudgetSpent")<{
  source: MeteredKernelSource;
  cap: "daily" | "monthly";
  spentUsd: number;
  budgetUsd: number;
  periodStart: Date;
  nextPeriodStart: Date;
}> {
  override get message() {
    const name = INGESTION_SOURCE_DISPLAY_NAMES[this.source];
    const spent = `$${this.spentUsd.toFixed(2)} of its $${this.budgetUsd.toFixed(2)}`;
    if (this.cap === "monthly") {
      const day = (date: Date) => date.toISOString().slice(0, 10);
      return `${name} has spent ${spent} monthly Kernel budget since ${day(this.periodStart)} (kernel_browser_usage), so no browser was opened and Big D and Northwest keep the rest of Kernel's credit. Its chunks defer, opening no browser, until ${day(this.nextPeriodStart)}, and a run still deferred after three hours fails, so the source shows as failing until then; raise KERNEL_MONTHLY_BUDGET_USD in kernel-usage.ts only if the Kernel dashboard shows credit to spare.`;
    }
    const minute = (date: Date) =>
      `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
    return `${name} has spent ${spent} daily Kernel cap since ${minute(this.periodStart)} (kernel_browser_usage), so no browser was opened; a full day's crawl costs about $0.03, so its chunks are most likely failing and retrying. Its chunks defer, opening no browser, until the cap resets at ${minute(this.nextPeriodStart)}; a run still deferred after three hours fails and the next scheduled run tries again, and prior inventory is preserved. Read the run's errors in /admin before raising KERNEL_DAILY_BUDGET_USD in kernel-usage.ts.`;
  }
}

function monthStart(now: Date, monthsAhead = 0): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthsAhead, 1),
  );
}

function dayStart(now: Date, daysAhead = 0): Date {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + daysAhead,
    ),
  );
}

/** The source's Kernel spend from the first of `now`'s UTC month. */
function monthToDateUsd(
  database: LibSQLDatabase,
  source: MeteredKernelSource,
  now: Date,
): Promise<number> {
  return spentSinceUsd(database, source, monthStart(now), now);
}

/** The source's Kernel spend from the start of `now`'s UTC day. */
function dayToDateUsd(
  database: LibSQLDatabase,
  source: MeteredKernelSource,
  now: Date,
): Promise<number> {
  return spentSinceUsd(database, source, dayStart(now), now);
}

/** The cap the source's spend has reached, the monthly one first, or null. */
async function capReached(
  database: LibSQLDatabase,
  source: MeteredKernelSource,
  now: Date,
): Promise<KernelBudgetSpent | null> {
  const monthly = await monthToDateUsd(database, source, now);
  if (monthly >= KERNEL_MONTHLY_BUDGET_USD[source])
    return new KernelBudgetSpent({
      source,
      cap: "monthly",
      spentUsd: monthly,
      budgetUsd: KERNEL_MONTHLY_BUDGET_USD[source],
      periodStart: monthStart(now),
      nextPeriodStart: monthStart(now, 1),
    });
  const daily = await dayToDateUsd(database, source, now);
  if (daily >= KERNEL_DAILY_BUDGET_USD[source])
    return new KernelBudgetSpent({
      source,
      cap: "daily",
      spentUsd: daily,
      budgetUsd: KERNEL_DAILY_BUDGET_USD[source],
      periodStart: dayStart(now),
      nextPeriodStart: dayStart(now, 1),
    });
  return null;
}

/**
 * The source's Kernel spend from `from` to `now`: each browser started since
 * `from`, billed for its seconds from create to delete at its mode's rate. A
 * browser not yet closed counts until `now`, at most its longest possible
 * life.
 */
async function spentSinceUsd(
  database: LibSQLDatabase,
  source: MeteredKernelSource,
  from: Date,
  now: Date,
): Promise<number> {
  const rows = await database
    .select({
      mode: kernelBrowserUsage.mode,
      startedAt: kernelBrowserUsage.startedAt,
      endedAt: kernelBrowserUsage.endedAt,
    })
    .from(kernelBrowserUsage)
    .where(
      and(
        eq(kernelBrowserUsage.source, source),
        gte(kernelBrowserUsage.startedAt, from.getTime()),
      ),
    );
  return rows.reduce((total, row) => {
    const end =
      row.endedAt ?? Math.min(now.getTime(), row.startedAt + MAX_BROWSER_MS);
    const seconds = Math.max(0, end - row.startedAt) / 1_000;
    return total + seconds * KERNEL_USD_PER_SECOND[row.mode];
  }, 0);
}

/**
 * `sessions` with each browser recorded in `kernel_browser_usage`, and a
 * create refused with `KernelBudgetSpent` once the source's spend this UTC
 * month reaches its monthly budget, or this UTC day its daily cap. The row is written before the browser is created,
 * so a process that dies with it open still counts it; a refused create
 * counts nothing, and a failed delete counts until Kernel deletes it.
 */
function metered(
  sessions: BrowserSessions,
  params: {
    database: LibSQLDatabase;
    source: MeteredKernelSource;
    now?: () => Date;
  },
): BrowserSessions {
  const { database, source } = params;
  const now = params.now ?? (() => new Date());
  const mode = KernelSessions.browserProfile(source).mode;
  const rows = new Map<string, string>();
  // A row left open counts its longest possible life, more than the browser
  // billed, so a failed write only makes the guard stricter; it is logged
  // and never replaces the provider's own result.
  const close = (rowId: string, endedAt: number) =>
    database
      .update(kernelBrowserUsage)
      .set({ endedAt })
      .where(eq(kernelBrowserUsage.id, rowId))
      .then(
        () => undefined,
        (cause: unknown) => {
          console.warn(
            `The kernel_browser_usage row ${rowId} for ${source} was not closed: ${String(cause)}. The monthly Kernel budget counts that browser as open for ${MAX_BROWSER_MS / 1_000} s, more than it billed; nothing else is affected.`,
          );
        },
      );
  return {
    ...sessions,
    create: async () => {
      const at = now();
      const refused = await capReached(database, source, at);
      if (refused) throw refused;
      const rowId = crypto.randomUUID();
      await database
        .insert(kernelBrowserUsage)
        .values({ id: rowId, source, mode, startedAt: at.getTime() });
      try {
        const session = await sessions.create();
        rows.set(session.id, rowId);
        return session;
      } catch (cause) {
        // Kernel bills nothing for a create it refused.
        await close(rowId, at.getTime());
        throw cause;
      }
    },
    stop: async (id) => {
      const rowId = rows.get(id);
      rows.delete(id);
      try {
        const stopped = await sessions.stop(id);
        if (rowId !== undefined) await close(rowId, now().getTime());
        return stopped;
      } catch (cause) {
        // Kernel deletes it this long after its CDP connection closed.
        if (rowId !== undefined)
          await close(
            rowId,
            now().getTime() + KERNEL_SESSION_TIMEOUT_SECONDS * 1_000,
          );
        throw cause;
      }
    },
  };
}

export const KernelUsage = {
  monthToDateUsd,
  dayToDateUsd,
  capReached,
  metered,
} as const;
