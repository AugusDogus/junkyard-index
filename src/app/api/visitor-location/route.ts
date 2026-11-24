import { geolocation } from "@vercel/functions";
import { VisitorLocation } from "~/lib/visitor-location";

export const dynamic = "force-dynamic";

/**
 * The visitor's approximate location from Vercel's IP headers, for the yard
 * map on pages served from the CDN. It reads no database and is never cached,
 * since it differs per visitor.
 */
export function GET(request: Request) {
  return Response.json(
    VisitorLocation.response(VisitorLocation.fromGeo(geolocation(request))),
    { headers: { "cache-control": "private, no-store" } },
  );
}
