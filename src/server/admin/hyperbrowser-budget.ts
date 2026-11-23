import { z } from "zod";
import { AdminSeries, type DayValue } from "./admin-series";

/** Days of credit burn the budgets page charts. */
export const HYPERBROWSER_BURN_DAYS = 14;
/** Full days before today the forecast averages. */
export const HYPERBROWSER_FORECAST_DAYS = 7;
/** Sessions per sessions.list page: the most Hyperbrowser allows. */
export const HYPERBROWSER_SESSION_PAGE_SIZE = 100;
/**
 * Pages read at most, so a burst of sessions cannot make the page slow.
 * 3,000 sessions cover 14 days at about 200 sessions a day.
 */
export const HYPERBROWSER_SESSION_PAGE_CAP = 30;

/** The team's credits, as Hyperbrowser reports them. */
export type HyperbrowserCredits = {
  usage: number;
  limit: number;
  remaining: number;
};

/**
 * What the budgets page reads from Hyperbrowser. Plain JSON (days as
 * strings, times as epoch ms) so it can sit in the Next.js data cache.
 */
export type HyperbrowserSnapshot = {
  credits: HyperbrowserCredits;
  /** Credits used per UTC day by sessions created that day, oldest first. */
  daily: DayValue[];
  /**
   * Partial when the page cap stopped the read before it reached the first
   * day: `fromDay` (the oldest day read) and the days before it are short.
   * Unordered when Hyperbrowser did not list sessions newest first, so any
   * day may be short.
   */
  coverage:
    | { kind: "complete" }
    | { kind: "partial"; fromDay: string }
    | { kind: "unordered" };
  fetchedAt: number;
};

/** Dated from the snapshot's `fetchedAt`, so a cached snapshot stays consistent. */
export type HyperbrowserForecast =
  /** No credits remain, whatever the recent use. */
  | { kind: "out" }
  /** No day before the read was read in full, so there is no pace. */
  | { kind: "unmeasured" }
  | {
      kind: "measured";
      /** Credits a day over up to 7 fully read UTC days before the read. */
      averagePerDay: number;
      /** How many days that average covers. */
      fullDays: number;
      /** Credits used by the end of that UTC month at that average. */
      projectedMonthEndUsage: number;
      runsOut:
        | { kind: "never" }
        | { kind: "on"; day: string; beforeMonthEnd: boolean };
    };

/** The parts of the Hyperbrowser client the budget reads. */
export type HyperbrowserBudgetClient = {
  readonly team: { getCreditInfo(): Promise<unknown> };
  readonly sessions: {
    list(params: { page: number; limit: number }): Promise<unknown>;
  };
};

const CreditsSchema = z.object({
  usage: z.number(),
  limit: z.number(),
  remaining: z.number(),
});

// Only the fields the budget uses. Hyperbrowser sends startTime and endTime
// as strings although the SDK types say numbers, so the SDK's types are not
// trusted here.
const SessionPageSchema = z.object({
  totalCount: z.number(),
  sessions: z.array(
    z.object({
      createdAt: z.string().datetime({ offset: true }),
      creditsUsed: z.number().nullable(),
    }),
  ),
});

function parse<Schema extends z.ZodTypeAny>(
  schema: Schema,
  raw: unknown,
  operation: string,
): z.infer<Schema> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Hyperbrowser ${operation} answered in a shape the budgets page does not expect, so its credits are not shown. Nothing was changed. The Hyperbrowser API or SDK may have changed; compare the response with src/server/admin/hyperbrowser-budget.ts. Problems: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}

export const HyperbrowserBudget = {
  /**
   * Credits, and credits per day for the last 14 UTC days from the sessions
   * list, reading pages until one reaches past the first day or the page
   * cap. Stopping early relies on the list being newest first, which the
   * SDK does not document, so a session newer than one before it stops the
   * read as `unordered`. Sessions carry no source, so burn is a total.
   */
  async read(
    client: HyperbrowserBudgetClient,
    now: Date,
  ): Promise<HyperbrowserSnapshot> {
    const days = AdminSeries.lastDays(now, HYPERBROWSER_BURN_DAYS);
    const windowStart = AdminSeries.dayStart(
      days[0] ?? AdminSeries.dayKey(now),
    );
    const [credits, sessions] = await Promise.all([
      client.team
        .getCreditInfo()
        .then((raw) => parse(CreditsSchema, raw, "team.getCreditInfo")),
      (async () => {
        const rows: DayValue[] = [];
        let oldest: Date | null = null;
        for (let page = 1; page <= HYPERBROWSER_SESSION_PAGE_CAP; page++) {
          const result = parse(
            SessionPageSchema,
            await client.sessions.list({
              page,
              limit: HYPERBROWSER_SESSION_PAGE_SIZE,
            }),
            `sessions.list page ${page}`,
          );
          for (const session of result.sessions) {
            const createdAt = new Date(session.createdAt);
            if (oldest !== null && createdAt > oldest) {
              return { rows, coverage: { kind: "unordered" } as const };
            }
            oldest = createdAt;
            rows.push({
              day: AdminSeries.dayKey(createdAt),
              value: session.creditsUsed ?? 0,
            });
          }
          const reachedStart = oldest !== null && oldest < windowStart;
          const noMore =
            result.sessions.length < HYPERBROWSER_SESSION_PAGE_SIZE ||
            page * HYPERBROWSER_SESSION_PAGE_SIZE >= result.totalCount;
          if (reachedStart || noMore) {
            return { rows, coverage: { kind: "complete" } as const };
          }
        }
        return {
          rows,
          coverage: {
            kind: "partial",
            fromDay: AdminSeries.dayKey(oldest ?? now),
          } as const,
        };
      })(),
    ]);
    return {
      credits,
      daily: AdminSeries.fillDays(sessions.rows, days),
      coverage: sessions.coverage,
      fetchedAt: now.getTime(),
    };
  },

  /**
   * Month-end usage and the day credits run out, at the recent average,
   * as of when the snapshot was read. Only fully read days are averaged.
   */
  forecast(snapshot: HyperbrowserSnapshot): HyperbrowserForecast {
    const { usage, remaining } = snapshot.credits;
    if (remaining <= 0) return { kind: "out" };
    const { coverage } = snapshot;
    if (coverage.kind === "unordered") return { kind: "unmeasured" };
    const readAt = snapshot.fetchedAt;
    const readDate = new Date(readAt);
    const today = AdminSeries.dayKey(readDate);
    const fullDays = snapshot.daily
      .filter(
        (entry) =>
          entry.day < today &&
          (coverage.kind === "complete" || entry.day > coverage.fromDay),
      )
      .slice(-HYPERBROWSER_FORECAST_DAYS);
    if (fullDays.length === 0) return { kind: "unmeasured" };
    const averagePerDay =
      fullDays.reduce((sum, entry) => sum + entry.value, 0) / fullDays.length;
    const monthEnd = Date.UTC(
      readDate.getUTCFullYear(),
      readDate.getUTCMonth() + 1,
      1,
    );
    const daysLeft = (monthEnd - readAt) / AdminSeries.DAY_MS;
    if (averagePerDay <= 0) {
      return {
        kind: "measured",
        averagePerDay: 0,
        fullDays: fullDays.length,
        projectedMonthEndUsage: usage,
        runsOut: { kind: "never" },
      };
    }
    const runsOutAt = readAt + (remaining / averagePerDay) * AdminSeries.DAY_MS;
    return {
      kind: "measured",
      averagePerDay,
      fullDays: fullDays.length,
      projectedMonthEndUsage: usage + averagePerDay * daysLeft,
      runsOut: {
        kind: "on",
        day: AdminSeries.dayKey(new Date(runsOutAt)),
        beforeMonthEnd: runsOutAt < monthEnd,
      },
    };
  },
} as const;
