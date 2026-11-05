import { env } from "~/env";
import { db } from "~/lib/db";
import { hasValidCronAuthorization } from "~/server/workflows/cron-authorization";
import { captureVehicleDepartures } from "~/server/vehicle-departures";

/**
 * Records vehicles that left their yards. Runs hourly: ingestion deletes a
 * vehicle after 3 missed runs or 3 days, and a source whose runs fail after
 * reconciling can retry up to 3 times a day, 2 hours apart, so a vehicle can
 * go from listed to deleted in about 4 hours.
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
