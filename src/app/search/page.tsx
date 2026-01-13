import { headers } from "next/headers";
import { Suspense } from "react";
import { ErrorBoundary } from "~/components/ErrorBoundary";
import { Header } from "~/components/Header";
import { SearchPageContent } from "~/components/search/SearchPageContent";
import { auth } from "~/lib/auth";

export default async function SearchPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  return (
    <div className="bg-background min-h-screen">
      <Header />
      <ErrorBoundary>
        <Suspense>
          <SearchPageContent isLoggedIn={!!session?.user} />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
