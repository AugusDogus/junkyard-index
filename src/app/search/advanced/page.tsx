import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";
import { ErrorBoundary } from "~/components/ErrorBoundary";
import { Footer } from "~/components/Footer";
import { Header } from "~/components/Header";
import { ScrollToTop } from "~/components/ScrollToTop";
import { AdvancedSearchPageContent } from "~/components/search/AdvancedSearchPageContent";
import { auth } from "~/lib/auth";
import { api, HydrateClient } from "~/trpc/server";

export const metadata: Metadata = {
  title: "Advanced Search",
  description:
    "Build a precise salvage yard inventory search with Boolean keywords, vehicle details, yard filters, and sorting.",
  alternates: { canonical: "/search/advanced" },
};

export default async function AdvancedSearchPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const isLoggedIn = Boolean(session?.user);
  await Promise.all([
    api.status.searchCapabilities.prefetch(),
    api.status.searchFacetOptions.prefetch(),
    isLoggedIn
      ? api.subscription.getAccountOverview.prefetch()
      : Promise.resolve(),
  ]);

  return (
    <div className="bg-background flex min-h-svh flex-col">
      <Header />
      <div className="flex-1">
        <ErrorBoundary>
          <Suspense>
            <HydrateClient>
              <AdvancedSearchPageContent isLoggedIn={isLoggedIn} />
            </HydrateClient>
          </Suspense>
        </ErrorBoundary>
      </div>
      <Footer />
      <ScrollToTop />
    </div>
  );
}
