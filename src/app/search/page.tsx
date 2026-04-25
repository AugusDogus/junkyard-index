import { type Metadata } from "next";
import { Suspense } from "react";
import { ErrorBoundary } from "~/components/ErrorBoundary";
import { Footer } from "~/components/Footer";
import { HeaderContent } from "~/components/HeaderContent";
import { ScrollToTop } from "~/components/ScrollToTop";
import { SearchPageContent } from "~/components/search/SearchPageContent";
import { SearchVisibilityProvider } from "~/context/SearchVisibilityContext";

export const metadata: Metadata = {
  title: "Search Salvage Yard Inventory",
  description:
    "Search donor vehicles across salvage yard networks, compare results by yard and distance, and create saved searches for ongoing inventory tracking.",
  alternates: {
    canonical: "/search",
  },
};

export default async function SearchPage() {
  return (
    <SearchVisibilityProvider>
      <div className="bg-background flex min-h-svh flex-col">
        <HeaderContent user={null} statusData={null} />
        <div className="flex-1">
          <ErrorBoundary>
            <Suspense>
              <SearchPageContent />
            </Suspense>
          </ErrorBoundary>
        </div>
        <Footer />
        <ScrollToTop />
      </div>
    </SearchVisibilityProvider>
  );
}
