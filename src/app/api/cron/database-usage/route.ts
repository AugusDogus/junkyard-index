import * as Sentry from "@sentry/nextjs";
import { env } from "~/env";
import { TursoUsage } from "~/server/turso-usage";
import { checkTursoUsage } from "~/server/turso-usage-runtime";
import { hasValidCronAuthorization } from "~/server/workflows/cron-authorization";

// Daily: compares this month's Turso rows read and written with the
// Developer plan quota at the month-to-date pace, and raises a Sentry issue
// when the month is on track to pass 80% of it. Reads no database rows.
export async function GET(request: Request) {
  if (
    !hasValidCronAuthorization(
      request.headers.get("authorization"),
      env.CRON_SECRET,
    )
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const check = await checkTursoUsage();
  const alert = TursoUsage.alert(check);
  if (alert !== null) {
    Sentry.captureMessage(alert.message, {
      level: alert.level,
      fingerprint: [
        "turso-usage",
        check.kind === "measured" ? check.status : check.kind,
      ],
      tags: { failure_category: "turso-usage" },
      extra: { check },
    });
    await Sentry.flush(2_000);
  }
  return Response.json({ databaseUsage: check, alerted: alert !== null });
}
