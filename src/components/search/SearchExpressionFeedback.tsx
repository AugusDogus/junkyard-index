"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SearchField } from "~/components/search/SearchField";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import type { SearchExpressionError } from "~/lib/algolia-search";

/** Expected URL errors must be handled before InstantSearchNext waits for results. */
export function SearchExpressionFeedback({
  error,
  isLoggedIn,
}: {
  error: SearchExpressionError;
  isLoggedIn: boolean;
}) {
  const params = useSearchParams();
  const query = params.get("q") ?? "";
  const returnTo = `/search?${params.toString()}`;
  return (
    <main className="mx-auto w-full max-w-7xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="sr-only">Search inventory</h1>
      <Alert>
        <AlertTitle>Search could not run</AlertTitle>
        <AlertDescription id="search-expression-error">
          <p>{error.message}</p>
          <p>Your search is preserved below. Edit it and try again.</p>
        </AlertDescription>
      </Alert>
      <form action="/search" method="get" role="search">
        <label className="sr-only" htmlFor="search-expression">
          Search expression
        </label>
        {Array.from(params.entries())
          .filter(([name]) => name !== "q")
          .map(([name, value], index) => (
            <input
              key={`${name}-${index}`}
              type="hidden"
              name={name}
              value={value}
            />
          ))}
        <SearchField
          key={query}
          id="search-expression"
          name="q"
          defaultValue={query}
          aria-invalid={error.kind === "invalid"}
          aria-describedby="search-expression-error"
        />
      </form>
      {error.kind === "upgrade_required" && (
        <div className="flex gap-3">
          {!isLoggedIn && (
            <Button asChild variant="outline">
              <Link
                href={`/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`}
              >
                Sign in
              </Link>
            </Button>
          )}
          <Button asChild>
            <Link href="/pricing">See plans</Link>
          </Button>
        </div>
      )}
    </main>
  );
}
