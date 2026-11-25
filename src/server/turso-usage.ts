import { z } from "zod";

/**
 * Turso's Developer plan quota per billing month (the calendar month, UTC).
 * Usage past it is billed as overage, so the guard warns well before.
 */
export const TURSO_DEVELOPER_PLAN = {
  rowsRead: 2_500_000_000,
  rowsWritten: 25_000_000,
} as const;

/** Share of the quota a month may project to before the guard warns. */
export const TURSO_USAGE_HEADROOM = 0.8;

/**
 * Rows the production database may read or write in 24 hours before the
 * guard calls it a spike: a runaway operation (a quadratic scan, a mass
 * rewrite, a reindex loop). About three normal days at the targets of 50M
 * reads and 0.5M writes, and under a tenth of the month's quota.
 */
export const TURSO_DAILY_SPIKE = {
  rowsRead: 150_000_000,
  rowsWritten: 2_000_000,
} as const;

export type TursoMeter = keyof typeof TURSO_DEVELOPER_PLAN;

const METERS: readonly TursoMeter[] = ["rowsRead", "rowsWritten"];

/** Rows the organization read and wrote so far this billing month. */
export type TursoUsageTotals = Record<TursoMeter, number>;

export type TursoPaceStatus = "on_pace" | "over_pace" | "over_quota";

export type TursoMeterPace = {
  used: number;
  quota: number;
  /** Month-end total at the month-to-date daily average. */
  projected: number;
  status: TursoPaceStatus;
};

export type TursoPaceReport = {
  /** The worst meter's status. */
  status: TursoPaceStatus;
  meters: Record<TursoMeter, TursoMeterPace>;
  /** ISO time the usage was read. */
  measuredAt: string;
};

/** The production database's rows in the 24 hours before the check. */
export type TursoLastDay = TursoUsageTotals & {
  /** Meters past TURSO_DAILY_SPIKE. */
  spiking: TursoMeter[];
};

/**
 * The Platform API credentials the guard reads usage with, and the
 * production database whose last 24 hours it checks for spikes.
 */
export type TursoUsageAccess = {
  token: string;
  organization: string;
  database: string;
};

/** What the guard knows about this month's usage. */
export type TursoUsageCheck =
  /** The Platform API credentials are not set, so nothing is measured. */
  | { kind: "unconfigured"; missing: string[] }
  | { kind: "unavailable"; message: string }
  | ({ kind: "measured"; lastDay: TursoLastDay } & TursoPaceReport);

export type TursoUsageAlert = {
  kind: "unconfigured" | "unavailable" | "pace" | "spike";
  level: "warning" | "error";
  message: string;
};

type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<Response>;

/** /api/status waits on this read, so a slow Platform API cannot hold it. */
const READ_TIMEOUT_MS = 5_000;

const DAY_MS = 24 * 60 * 60 * 1000;

// The quota is the organization's, so every database in it counts,
// development copies included.
const UsageSchema = z.object({
  rows_read: z.number().nonnegative(),
  rows_written: z.number().nonnegative(),
});
const OrganizationUsageSchema = z.object({
  organization: z.object({ usage: UsageSchema }),
});
// Turso's reference nests the totals under `database`; responses seen in
// November 2026 also carried them at the top level. Either is read.
const DatabaseUsageSchema = z
  .union([
    z.object({ total: UsageSchema }),
    z.object({ database: z.object({ total: UsageSchema }) }),
  ])
  .transform((usage) =>
    "total" in usage ? usage.total : usage.database.total,
  );

async function readUsage<Schema extends z.ZodTypeAny>(
  url: string,
  access: Pick<TursoUsageAccess, "token">,
  schema: Schema,
  what: string,
  fetchImpl: FetchLike,
): Promise<z.infer<Schema>> {
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${access.token}` },
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `Turso's Platform API answered HTTP ${response.status} for ${what}, so the database usage guard has no figures. Nothing was changed. Check that TURSO_PLATFORM_API_TOKEN is a current Platform API token with access to that organization.`,
    );
  }
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error(
      `Turso's ${what} answered in a shape the usage guard does not expect, so it has no figures. Nothing was changed. Compare the response with src/server/turso-usage.ts. Problems: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}

const STATUS_RANK: Record<TursoPaceStatus, number> = {
  on_pace: 0,
  over_pace: 1,
  over_quota: 2,
};

function meterPace(
  used: number,
  quota: number,
  elapsedDays: number,
  monthDays: number,
): TursoMeterPace {
  // A month's first hours project from at least one day, so one busy hour
  // does not read as a month of them.
  const projected = Math.round((used / Math.max(elapsedDays, 1)) * monthDays);
  const status: TursoPaceStatus =
    used > quota
      ? "over_quota"
      : projected > quota * TURSO_USAGE_HEADROOM
        ? "over_pace"
        : "on_pace";
  return { used, quota, projected, status };
}

function billions(rows: number): string {
  return rows >= 100_000_000
    ? `${(rows / 1_000_000_000).toFixed(2)}B`
    : `${(rows / 1_000_000).toFixed(1)}M`;
}

const METER_LABELS: Record<TursoMeter, string> = {
  rowsRead: "rows read",
  rowsWritten: "rows written",
};

export const TursoUsage = {
  /** The organization's usage this billing month, from the Platform API. */
  async read(
    access: Omit<TursoUsageAccess, "database">,
    fetchImpl: FetchLike = fetch,
  ): Promise<TursoUsageTotals> {
    const usage = await readUsage(
      `https://api.turso.tech/v1/organizations/${encodeURIComponent(access.organization)}/usage`,
      access,
      OrganizationUsageSchema,
      `organization "${access.organization}" usage (organization.usage.rows_read and rows_written)`,
      fetchImpl,
    );
    return {
      rowsRead: usage.organization.usage.rows_read,
      rowsWritten: usage.organization.usage.rows_written,
    };
  },

  /** One database's usage between two times, from the Platform API. */
  async readDatabase(
    access: TursoUsageAccess,
    from: Date,
    to: Date,
    fetchImpl: FetchLike = fetch,
  ): Promise<TursoUsageTotals> {
    const query = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
    });
    const usage = await readUsage(
      `https://api.turso.tech/v1/organizations/${encodeURIComponent(access.organization)}/databases/${encodeURIComponent(access.database)}/usage?${query}`,
      access,
      DatabaseUsageSchema,
      `database "${access.database}" usage (total or database.total rows_read and rows_written)`,
      fetchImpl,
    );
    return { rowsRead: usage.rows_read, rowsWritten: usage.rows_written };
  },

  /**
   * The database a libsql URL names in `organization`: Turso hosts are
   * `<database>-<organization>.<region>.turso.io`. Null when it names none.
   */
  databaseName(url: string, organization: string): string | null {
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      return null;
    }
    const label = host.split(".")[0] ?? "";
    const suffix = `-${organization}`;
    return label.endsWith(suffix) && label.length > suffix.length
      ? label.slice(0, -suffix.length)
      : null;
  },

  /** Which meters of a day's usage passed TURSO_DAILY_SPIKE. */
  lastDay(usage: TursoUsageTotals): TursoLastDay {
    return {
      ...usage,
      spiking: METERS.filter(
        (meter) => usage[meter] > TURSO_DAILY_SPIKE[meter],
      ),
    };
  },

  /** Compares month-to-date usage with the plan quota at today's pace. */
  pace(usage: TursoUsageTotals, now: Date): TursoPaceReport {
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const monthEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    const elapsedDays = (now.getTime() - monthStart) / DAY_MS;
    const monthDays = (monthEnd - monthStart) / DAY_MS;
    const meters: Record<TursoMeter, TursoMeterPace> = {
      rowsRead: meterPace(
        usage.rowsRead,
        TURSO_DEVELOPER_PLAN.rowsRead,
        elapsedDays,
        monthDays,
      ),
      rowsWritten: meterPace(
        usage.rowsWritten,
        TURSO_DEVELOPER_PLAN.rowsWritten,
        elapsedDays,
        monthDays,
      ),
    };
    const status =
      STATUS_RANK[meters.rowsRead.status] >=
      STATUS_RANK[meters.rowsWritten.status]
        ? meters.rowsRead.status
        : meters.rowsWritten.status;
    return { status, meters, measuredAt: now.toISOString() };
  },

  /** Reads and paces usage, and the last day's for spikes; never throws. */
  async check(
    access: {
      token: string | undefined;
      organization: string | undefined;
      database: string | undefined;
    },
    now: Date,
    fetchImpl: FetchLike = fetch,
  ): Promise<TursoUsageCheck> {
    const { token, organization, database } = access;
    if (
      token === undefined ||
      organization === undefined ||
      database === undefined
    ) {
      return {
        kind: "unconfigured",
        missing: [
          ...(token === undefined ? ["TURSO_PLATFORM_API_TOKEN"] : []),
          ...(organization === undefined ? ["TURSO_ORGANIZATION"] : []),
          ...(organization !== undefined && database === undefined
            ? [
                `a TURSO_DATABASE_URL host naming a database in "${organization}"`,
              ]
            : []),
        ],
      };
    }
    try {
      const [month, day] = await Promise.all([
        TursoUsage.read({ token, organization }, fetchImpl),
        TursoUsage.readDatabase(
          { token, organization, database },
          new Date(now.getTime() - DAY_MS),
          now,
          fetchImpl,
        ),
      ]);
      return {
        kind: "measured",
        ...TursoUsage.pace(month, now),
        lastDay: TursoUsage.lastDay(day),
      };
    } catch (error) {
      return {
        kind: "unavailable",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },

  /**
   * The Sentry issues a check raises: a spike in the last 24 hours whenever
   * it is seen, and the month's pace (and an unconfigured or unreadable
   * guard) only when `pace` is asked for, once a day.
   */
  alerts(
    check: TursoUsageCheck,
    options: { pace: boolean },
  ): TursoUsageAlert[] {
    switch (check.kind) {
      case "unconfigured":
        return options.pace
          ? [
              {
                kind: "unconfigured",
                level: "warning",
                message: `The Turso usage guard is not configured (${check.missing.join(" and ")} unset), so nothing warns before the Developer plan quota is exceeded. Set them in the Vercel project's production environment.`,
              },
            ]
          : [];
      case "unavailable":
        return options.pace
          ? [
              {
                kind: "unavailable",
                level: "warning",
                message: `The Turso usage guard could not read usage, so it cannot say whether the plan quota holds. ${check.message}`,
              },
            ]
          : [];
      case "measured": {
        const alerts: TursoUsageAlert[] = [];
        const { lastDay } = check;
        if (lastDay.spiking.length > 0) {
          alerts.push({
            kind: "spike",
            level: "warning",
            message: `The production database used ${lastDay.spiking
              .map(
                (meter) =>
                  `${billions(lastDay[meter])} ${METER_LABELS[meter]} (spike threshold ${billions(TURSO_DAILY_SPIKE[meter])})`,
              )
              .join(
                " and ",
              )} in the last 24 hours, so an operation may be running away. Nothing was stopped. Find it in the Turso analytics (top queries for today) and Sentry traces, and stop or narrow it before it uses the month's quota.`,
          });
        }
        if (!options.pace || check.status === "on_pace") return alerts;
        const over = METERS.filter(
          (meter) => check.meters[meter].status !== "on_pace",
        ).map((meter) => {
          const { used, projected, quota } = check.meters[meter];
          return `${billions(projected)} of ${billions(quota)} ${METER_LABELS[meter]} projected for the month (${billions(used)} so far)`;
        });
        alerts.push(
          check.status === "over_quota"
            ? {
                kind: "pace",
                level: "error",
                message: `Turso usage passed the Developer plan quota, so overage is being billed: ${over.join("; ")}. Find the heavy queries with the Turso analytics (top queries per day) and stop or narrow them.`,
              }
            : {
                kind: "pace",
                level: "warning",
                message: `Turso usage is on pace to pass ${Math.round(TURSO_USAGE_HEADROOM * 100)}% of the Developer plan quota: ${over.join("; ")}. Nothing is billed yet. Find the heavy queries with the Turso analytics (top queries per day) before the month ends.`,
              },
        );
        return alerts;
      }
    }
  },
} as const;
