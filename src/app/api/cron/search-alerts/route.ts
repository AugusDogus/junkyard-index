import pRetry from "p-retry";
import { start } from "workflow/api";
import { env } from "~/env";
import { hasDeliverableNotificationIntents } from "~/server/alerts/durable-alert-delivery-runtime";
import {
  isPastSearchAlertDeadline,
  startDailySearchAlerts,
} from "~/server/alerts/daily-search-alert-trigger";
import {
  openDailySearchAlertCheck,
  searchAlertsEnabled,
} from "~/server/alerts/search-alert-check-runtime";
import { hasValidCronAuthorization } from "~/server/workflows/cron-authorization";
import { workflowStartRetryOptions } from "~/server/workflows/start-retry";
import { IngestionDay } from "~/server/ingestion/ingestion-day";
import { vehicleNotificationDeliveryWorkflow } from "~/workflows/downstream-consumers";
import { searchAlertCheckWorkflow } from "~/workflows/vehicle-ingestion";

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
  // deadline on, this hourly cron starts it anyway and retries a check whose
  // workflow failed. Either way it starts delivery when a notification can
  // go out.
  const now = new Date();
  const day = IngestionDay.key(now);
  if (!isPastSearchAlertDeadline(now)) {
    return Response.json({ message: "Before the alert deadline", day });
  }
  const outcome = await pRetry(
    () =>
      startDailySearchAlerts(day, {
        now,
        alertsEnabled: searchAlertsEnabled,
        openCheck: openDailySearchAlertCheck,
        hasDeliverableIntents: hasDeliverableNotificationIntents,
        startCheck: (checkDay) => start(searchAlertCheckWorkflow, [checkDay]),
        startDelivery: () => start(vehicleNotificationDeliveryWorkflow),
      }),
    workflowStartRetryOptions,
  );
  return Response.json({ message: "Saved search alerts", day, outcome });
}
