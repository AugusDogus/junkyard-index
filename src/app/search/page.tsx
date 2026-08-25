import { geolocation } from "@vercel/functions";
import { type Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ErrorBoundary } from "~/components/ErrorBoundary";
import { Footer } from "~/components/Footer";
import { Header } from "~/components/Header";
import { ScrollToTop } from "~/components/ScrollToTop";
import { SearchPageContent } from "~/components/search/SearchPageContent";
import { SearchVisibilityProvider } from "~/context/SearchVisibilityContext";
import { auth } from "~/lib/auth";
import { quotaViewerFromSessionUser } from "~/lib/quota-viewer";
import { api, HydrateClient } from "~/trpc/server";

export const metadata: Metadata = {
  title: "Search Salvage Yard Inventory",
  description:
    "Search donor vehicles across salvage yard networks, compare results by yard and distance, and create saved searches for ongoing inventory tracking.",
  alternates: {
    canonical: "/search",
  },
};

interface SearchPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  if (params.customer_session_token !== undefined) {
    redirect("/search?subscription=success");
  }

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
  await Promise.all([
    api.status.searchCapabilities.prefetch(),
    viewer.kind === "authenticated"
      ? api.subscription.getAccountOverview.prefetch()
      : Promise.resolve(),
  ]);

  return (
    <SearchVisibilityProvider>
      <div className="bg-background flex min-h-svh flex-col">
        <Header />
        <div className="flex-1">
          <ErrorBoundary>
            <Suspense>
              <HydrateClient>
                <SearchPageContent viewer={viewer} userLocation={geo} />
              </HydrateClient>
            </Suspense>
          </ErrorBoundary>
        </div>
        <Footer />
        <ScrollToTop />
      </div>
    </SearchVisibilityProvider>
  );
}
