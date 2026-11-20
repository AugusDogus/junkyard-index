import { env } from "~/env";
import { db } from "~/lib/db";
import { hasValidCronAuthorization } from "~/server/workflows/cron-authorization";
import { captureVehicleDepartures } from "~/server/vehicle-departures";

/**
 * Records vehicles that left their yards. Runs hourly. Ingestion deletes a
 * vehicle once it has been missing for 72 hours, so hourly capture records a
 * departure well before the row is gone.
 */
export async function GET(request: Request) {
  if (
    !hasValidCronAuthorization(
      request.headers.get("authorization"),
      env.CRON_SECRET,
    )
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const capture = await captureVehicleDepartures(db, new Date());
  console.info("[VehicleDepartures] Captured departures", capture);
  return Response.json(capture);
}
