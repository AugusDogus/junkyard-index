import pRetry from "p-retry";
import { start } from "workflow/api";
import { env } from "~/env";
import { hasDeliverableNotificationIntents } from "~/server/alerts/durable-alert-delivery-runtime";
import { triggerNotificationDelivery } from "~/server/alerts/notification-delivery-trigger";
import { SearchAlertsFlag } from "~/server/alerts/search-alerts-flag";
import { ConsumerFlags } from "~/server/ingestion/consumer-flags";
import { reportConsumerTickNow } from "~/server/ingestion/consumer-report-runtime";
import { hasValidCronAuthorization } from "~/server/workflows/cron-authorization";
import { workflowStartRetryOptions } from "~/server/workflows/start-retry";
import { vehicleNotificationDeliveryWorkflow } from "~/workflows/downstream-consumers";

export async function GET(request: Request) {
  if (
    !hasValidCronAuthorization(
      request.headers.get("authorization"),
      env.CRON_SECRET,
    )
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Every 15 minutes, so retries, expired claims and released holds go out
  // on schedule instead of waiting for a pass or the alert deadline.
  try {
    const tick = await triggerNotificationDelivery({
      consumerMode: () => ConsumerFlags.mode("notification-delivery"),
      alertsEnabled: async () => (await SearchAlertsFlag.mode()) === "enabled",
      hasDeliverableIntents: hasDeliverableNotificationIntents,
      startDelivery: () =>
        pRetry(
          () => start(vehicleNotificationDeliveryWorkflow),
          workflowStartRetryOptions,
        ),
    });
    await reportConsumerTickNow("notification-delivery", "succeeded", tick);
    return Response.json({ consumer: "notification-delivery", tick });
  } catch (error) {
    await reportConsumerTickNow("notification-delivery", "failed", {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
