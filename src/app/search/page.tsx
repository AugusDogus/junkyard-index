import { headers } from "next/headers";
import { Suspense } from "react";
import { ErrorBoundary } from "~/components/ErrorBoundary";
import { Footer } from "~/components/Footer";
import { Header } from "~/components/Header";
import { ScrollToTop } from "~/components/ScrollToTop";
import { SearchPageContent } from "~/components/search/SearchPageContent";
import { SearchVisibilityProvider } from "~/context/SearchVisibilityContext";
import { auth } from "~/lib/auth";

export default async function SearchPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  return (
    <SearchVisibilityProvider>
      <div className="bg-background flex min-h-svh flex-col">
        <Header />
        <div className="flex-1">
          <ErrorBoundary>
            <Suspense>
              <SearchPageContent isLoggedIn={!!session?.user} />
            </Suspense>
          </ErrorBoundary>
        </div>
        <Footer />
        <ScrollToTop />
      </div>
    </SearchVisibilityProvider>
  );
}
