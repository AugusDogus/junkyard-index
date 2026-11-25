import * as Sentry from "@sentry/nextjs";
import { env } from "~/env";
import { TursoUsage } from "~/server/turso-usage";
import { checkTursoUsage } from "~/server/turso-usage-runtime";
import { hasValidCronAuthorization } from "~/server/workflows/cron-authorization";

// Hourly: raises a Sentry issue when the production database used more than
// TURSO_DAILY_SPIKE rows in the last 24 hours (a runaway operation), and
// once a day, at 07 UTC, when the month is on track to pass 80% of the
// Developer plan quota at its month-to-date pace. Reads no database rows.
const PACE_HOUR_UTC = 7;

export async function GET(request: Request) {
  if (
    !hasValidCronAuthorization(
      request.headers.get("authorization"),
      env.CRON_SECRET,
    )
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const now = new Date();
  const check = await checkTursoUsage(now);
  const alerts = TursoUsage.alerts(check, {
    pace: now.getUTCHours() === PACE_HOUR_UTC,
  });
  for (const alert of alerts) {
    Sentry.captureMessage(alert.message, {
      level: alert.level,
      fingerprint: ["turso-usage", alert.kind],
      tags: { failure_category: "turso-usage" },
      extra: { check },
    });
  }
  if (alerts.length > 0) await Sentry.flush(2_000);
  return Response.json({
    databaseUsage: check,
    alerted: alerts.map((alert) => alert.kind),
  });
}
