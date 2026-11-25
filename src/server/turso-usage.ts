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

export type TursoMeter = keyof typeof TURSO_DEVELOPER_PLAN;

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

/** The Platform API credentials the guard reads usage with. */
export type TursoUsageAccess = { token: string; organization: string };

/** What the guard knows about this month's usage. */
export type TursoUsageCheck =
  /** The Platform API credentials are not set, so nothing is measured. */
  | { kind: "unconfigured"; missing: string[] }
  | { kind: "unavailable"; message: string }
  | ({ kind: "measured" } & TursoPaceReport);

export type TursoUsageAlert = { level: "warning" | "error"; message: string };

type FetchLike = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<Response>;

const DAY_MS = 24 * 60 * 60 * 1000;

// The quota is the organization's, so every database in it counts,
// development copies included.
const OrganizationUsageSchema = z.object({
  organization: z.object({
    usage: z.object({
      rows_read: z.number().nonnegative(),
      rows_written: z.number().nonnegative(),
    }),
  }),
});

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
    access: TursoUsageAccess,
    fetchImpl: FetchLike = fetch,
  ): Promise<TursoUsageTotals> {
    const url = `https://api.turso.tech/v1/organizations/${encodeURIComponent(access.organization)}/usage`;
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${access.token}` },
    });
    if (!response.ok) {
      throw new Error(
        `Turso's Platform API answered HTTP ${response.status} for organization "${access.organization}" usage, so the database usage guard has no figures. Nothing was changed. Check that TURSO_PLATFORM_API_TOKEN is a current Platform API token with access to that organization.`,
      );
    }
    const parsed = OrganizationUsageSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error(
        `Turso's organization usage answered in a shape the usage guard does not expect (organization.usage.rows_read and rows_written), so it has no figures. Nothing was changed. Compare the response with src/server/turso-usage.ts. Problems: ${parsed.error.issues
          .map(
            (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
          )
          .join("; ")}`,
      );
    }
    const { rows_read, rows_written } = parsed.data.organization.usage;
    return { rowsRead: rows_read, rowsWritten: rows_written };
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

  /** Reads and paces usage; never throws. */
  async check(
    access: { token: string | undefined; organization: string | undefined },
    now: Date,
    fetchImpl: FetchLike = fetch,
  ): Promise<TursoUsageCheck> {
    const { token, organization } = access;
    if (token === undefined || organization === undefined) {
      return {
        kind: "unconfigured",
        missing: [
          ...(token === undefined ? ["TURSO_PLATFORM_API_TOKEN"] : []),
          ...(organization === undefined ? ["TURSO_ORGANIZATION"] : []),
        ],
      };
    }
    try {
      const usage = await TursoUsage.read({ token, organization }, fetchImpl);
      return { kind: "measured", ...TursoUsage.pace(usage, now) };
    } catch (error) {
      return {
        kind: "unavailable",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },

  /** The Sentry issue a check raises, or null when usage is on pace. */
  alert(check: TursoUsageCheck): TursoUsageAlert | null {
    switch (check.kind) {
      case "unconfigured":
        return {
          level: "warning",
          message: `The Turso usage guard is not configured (${check.missing.join(" and ")} unset), so nothing warns before the Developer plan quota is exceeded. Set them in the Vercel project's production environment.`,
        };
      case "unavailable":
        return {
          level: "warning",
          message: `The Turso usage guard could not read this month's usage, so it cannot say whether the plan quota holds. ${check.message}`,
        };
      case "measured": {
        if (check.status === "on_pace") return null;
        const over = (Object.keys(check.meters) as TursoMeter[])
          .filter((meter) => check.meters[meter].status !== "on_pace")
          .map((meter) => {
            const { used, projected, quota } = check.meters[meter];
            return `${billions(projected)} of ${billions(quota)} ${METER_LABELS[meter]} projected for the month (${billions(used)} so far)`;
          });
        return check.status === "over_quota"
          ? {
              level: "error",
              message: `Turso usage passed the Developer plan quota, so overage is being billed: ${over.join("; ")}. Find the heavy queries with the Turso analytics (top queries per day) and stop or narrow them.`,
            }
          : {
              level: "warning",
              message: `Turso usage is on pace to pass ${Math.round(TURSO_USAGE_HEADROOM * 100)}% of the Developer plan quota: ${over.join("; ")}. Nothing is billed yet. Find the heavy queries with the Turso analytics (top queries per day) before the month ends.`,
            };
      }
    }
  },
} as const;
