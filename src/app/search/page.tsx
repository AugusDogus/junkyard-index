import { geolocation } from "@vercel/functions";
import { type Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";
import { ErrorBoundary } from "~/components/ErrorBoundary";
import { Footer } from "~/components/Footer";
import { Header } from "~/components/Header";
import { ScrollToTop } from "~/components/ScrollToTop";
import { SearchPageContent } from "~/components/search/SearchPageContent";
import { SearchVisibilityProvider } from "~/context/SearchVisibilityContext";
import { auth } from "~/lib/auth";
import type { PlanAccessState } from "~/lib/plans";
import { quotaViewerFromSessionUser } from "~/lib/quota-viewer";
import { refreshPlanTier } from "~/server/billing/user-plan";

export const metadata: Metadata = {
  title: "Search Salvage Yard Inventory",
  description:
    "Search donor vehicles across salvage yard networks, compare results by yard and distance, and create saved searches for ongoing inventory tracking.",
  alternates: {
    canonical: "/search",
  },
};

export default async function SearchPage() {
  const reqHeaders = await headers();

  const [session, geo] = await Promise.all([
    auth.api.getSession({ headers: reqHeaders }),
    Promise.resolve().then(() => {
      try {
        // Vercel edge geolocation — available on Vercel deployments
        const g = geolocation({ headers: reqHeaders });
        if (g?.latitude && g?.longitude) {
          return {
            lat: parseFloat(g.latitude),
            lng: parseFloat(g.longitude),
          };
        }
      } catch {
        // Not on Vercel or geolocation unavailable
      }
      return undefined;
    }),
  ]);
  const viewer = quotaViewerFromSessionUser(session?.user);
  let initialPlanAccess: PlanAccessState = { kind: "resolved", tier: "free" };
  if (viewer.kind === "authenticated") {
    try {
      initialPlanAccess = {
        kind: "resolved",
        tier: await refreshPlanTier(viewer.userId),
      };
    } catch {
      initialPlanAccess = { kind: "unavailable", reason: "lookup_failed" };
    }
  }

  return (
    <SearchVisibilityProvider>
      <div className="bg-background flex min-h-svh flex-col">
        <Header />
        <div className="flex-1">
          <ErrorBoundary>
            <Suspense>
              <SearchPageContent
                viewer={viewer}
                initialPlanAccess={initialPlanAccess}
                userLocation={geo}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
        <Footer />
        <ScrollToTop />
      </div>
    </SearchVisibilityProvider>
  );
}
