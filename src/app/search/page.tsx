import { Suspense } from "react";
import { ErrorBoundary } from "~/components/ErrorBoundary";
import { Header } from "~/components/Header";
import { SearchPageContent } from "~/components/search/SearchPageContent";

export default function SearchPage() {
  return (
    <div className="bg-background min-h-screen">
      <Header />
      <ErrorBoundary>
        <Suspense>
          <SearchPageContent />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
