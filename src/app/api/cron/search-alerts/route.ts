import pRetry from "p-retry";
import { start } from "workflow/api";
import { env } from "~/env";
import { startDailySearchAlerts } from "~/server/alerts/daily-search-alert-trigger";
import { hasValidCronAuthorization } from "~/server/workflows/cron-authorization";
import { workflowStartRetryOptions } from "~/server/workflows/start-retry";
import { IngestionDay } from "~/server/ingestion/ingestion-day";
import {
  searchAlertCheckWorkflow,
  vehicleNotificationDeliveryWorkflow,
} from "~/workflows/vehicle-ingestion";

// 18:00 UTC. Passes usually finish by 16:00 UTC, including a failing
// source's third attempt; the deadline keeps a stuck source from holding
// back everyone's alerts.
const ALERT_CHECK_DEADLINE_MS = 11 * 60 * 60 * 1000;

export async function GET(request: Request) {
  if (
    !hasValidCronAuthorization(
      request.headers.get("authorization"),
      env.CRON_SECRET,
    )
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The day's pass starts the check when every source is done. From the
  // deadline on, this hourly cron starts it anyway, and retries a check whose
  // workflow failed; a finished check only retries delivery.
  const now = new Date();
  const day = IngestionDay.key(now);
  if (
    now.getTime() <
    IngestionDay.start(now).getTime() + ALERT_CHECK_DEADLINE_MS
  ) {
    return Response.json({ message: "Before the alert deadline", day });
  }
  const outcome = await pRetry(
    () =>
      startDailySearchAlerts(day, {
        check: (checkDay) => start(searchAlertCheckWorkflow, [checkDay]),
        delivery: () => start(vehicleNotificationDeliveryWorkflow),
      }),
    workflowStartRetryOptions,
  );
  return Response.json({ message: "Saved search alerts", day, outcome });
}
