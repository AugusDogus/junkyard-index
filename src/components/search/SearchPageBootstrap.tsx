import { appendFileSync } from "node:fs";
import { geolocation } from "@vercel/functions";
import { headers } from "next/headers";
import { SearchPageContent } from "~/components/search/SearchPageContent";
import { auth } from "~/lib/auth";

const DEBUG_LOG_PATH = "/opt/cursor/logs/debug.log";

export async function SearchPageBootstrap() {
  const reqHeaders = await headers();
  const startedAt = Date.now();

  // #region agent log
  appendFileSync(
    DEBUG_LOG_PATH,
    JSON.stringify({
      hypothesisId: "A",
      location: "SearchPageBootstrap.tsx:11",
      message: "Search bootstrap entered",
      data: { route: "/search" },
      timestamp: startedAt,
    }) + "\n",
  );
  // #endregion

  const [session, geo] = await Promise.all([
    auth.api.getSession({ headers: reqHeaders }),
    Promise.resolve().then(() => {
      try {
        const location = geolocation({ headers: reqHeaders });

        if (location?.latitude && location?.longitude) {
          return {
            lat: parseFloat(location.latitude),
            lng: parseFloat(location.longitude),
          };
        }
      } catch {
        // Geolocation is only available on supported deployments.
      }

      return undefined;
    }),
  ]);

  // #region agent log
  appendFileSync(
    DEBUG_LOG_PATH,
    JSON.stringify({
      hypothesisId: "A",
      location: "SearchPageBootstrap.tsx:38",
      message: "Search bootstrap resolved",
      data: {
        durationMs: Date.now() - startedAt,
        isLoggedIn: !!session?.user,
        hasGeo: !!geo,
      },
      timestamp: Date.now(),
    }) + "\n",
  );
  // #endregion

  return <SearchPageContent isLoggedIn={!!session?.user} userLocation={geo} />;
}
