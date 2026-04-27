import { geolocation } from "@vercel/functions";
import { headers } from "next/headers";
import { SearchPageContent } from "~/components/search/SearchPageContent";
import { getRequestSession } from "~/lib/request-session";

export async function SearchPageBootstrap({
  initialQuery,
}: {
  initialQuery?: string;
}) {
  const reqHeaders = await headers();
  const cookieHeader = reqHeaders.get("cookie");

  const [session, geo] = await Promise.all([
    getRequestSession(cookieHeader, reqHeaders),
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

  return (
    <SearchPageContent
      isLoggedIn={!!session?.user}
      userLocation={geo}
      initialQuery={initialQuery}
    />
  );
}
