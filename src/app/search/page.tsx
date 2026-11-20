import { geolocation } from "@vercel/functions";
import { type Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ErrorBoundary } from "~/components/ErrorBoundary";
import { Footer } from "~/components/Footer";
import { Header } from "~/components/Header";
import { ScrollToTop } from "~/components/ScrollToTop";
import { SearchPageSkeleton } from "~/components/search/SearchPageSkeleton";
import { SearchPageContent } from "~/components/search/SearchPageContent";
import { db } from "~/lib/db";
import { SearchServerRender } from "~/lib/search-server-render";
import { getHomepageYards } from "~/server/homepage-yards";
import { auth } from "~/lib/auth";
import { api, HydrateClient } from "~/trpc/server";

interface SearchPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({
  searchParams,
}: SearchPageProps): Promise<Metadata> {
  const params = await searchParams;
  return {
    title: "Search Salvage Yard Inventory",
    description:
      "Search donor vehicles across salvage yard networks, compare results by yard and distance, and create saved searches for ongoing inventory tracking.",
    alternates: {
      canonical: "/search",
    },
    // Each parameterized URL is one search, not a page of its own. Crawlers
    // follow its links but index only the canonical /search.
    ...(Object.keys(params).length > 0 && {
      robots: { index: false, follow: true },
    }),
  };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  if (params.customer_session_token !== undefined) {
    redirect("/search?subscription=success");
  }

  // Only legacy comma lists need a dictionary. Modern URLs preserve each value.
  const knownYardNames = [params.yards]
    .flat()
    .some((value) => value?.includes(","))
    ? (await getHomepageYards(db))
        .map((yard) => yard.name)
        .filter((name) => name.includes(","))
    : [];
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
  const isLoggedIn = Boolean(session?.user);
  await Promise.all([
    api.status.searchCapabilities.prefetch(),
    isLoggedIn
      ? api.subscription.getAccountOverview.prefetch()
      : Promise.resolve(),
  ]);

  return (
    <div className="bg-background flex min-h-svh flex-col">
      <Header />
      <div className="min-h-screen flex-1">
        <ErrorBoundary>
          <Suspense fallback={<SearchPageSkeleton />}>
            <HydrateClient>
              <SearchPageContent
                isLoggedIn={isLoggedIn}
                initialIsMobile={/Mobile|Android|iPhone|iPod/i.test(
                  reqHeaders.get("user-agent") ?? "",
                )}
                serverSearch={SearchServerRender.decide({
                  userAgent: reqHeaders.get("user-agent"),
                  params,
                })}
                userLocation={geo}
                knownYardNames={knownYardNames}
              />
            </HydrateClient>
          </Suspense>
        </ErrorBoundary>
      </div>
      <Footer />
      <ScrollToTop />
    </div>
  );
}
