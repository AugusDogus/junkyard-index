import { db } from "~/lib/db";
import { AlertStatus } from "~/server/alerts/alert-status";
import { DELIVERY_LEASE_MS } from "~/server/alerts/durable-alert-delivery-runtime";
import { SearchAlertsFlag } from "~/server/alerts/search-alerts-flag";

// One Better Stack monitor for saved-search alerts: 503 while the daily alert
// check is overdue or a deliverable notification has waited over 2 hours,
// 200 otherwise, including while alerts are paused by search-alerts-enabled.
export async function GET() {
  const now = new Date();
  const mode = await SearchAlertsFlag.mode();
  const status = AlertStatus.evaluate(
    await AlertStatus.load(db, now, mode, DELIVERY_LEASE_MS),
    now,
  );
  return Response.json(status, {
    status: status.status === "unhealthy" ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
