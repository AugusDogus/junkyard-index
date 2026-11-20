"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { SearchFailure } from "~/lib/search-failure";

/**
 * What /search shows when rendering it failed. A blocked search backend says
 * so and points to yard pages, which read Turso; anything else gets a
 * generic message. Vendor error text is never shown.
 */
export function SearchErrorFallback({
  error,
  retry,
}: {
  error: Error;
  retry: () => void;
}) {
  const failure = SearchFailure.classify(error);
  return (
    <div className="flex min-h-[400px] items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            {failure.kind === "backend_blocked"
              ? "Search is temporarily unavailable"
              : "Search could not load"}
          </AlertTitle>
          <AlertDescription className="mt-2">
            {failure.kind === "backend_blocked"
              ? "Yard pages still work. Try the search again later."
              : "Something went wrong on our side. Try again, or reload the page."}
          </AlertDescription>
        </Alert>
        <div className="mt-4 flex flex-col gap-2">
          <Button onClick={retry} className="w-full">
            <RefreshCw className="mr-2 h-4 w-4" />
            Try Again
          </Button>
          {failure.kind === "backend_blocked" && (
            <Button asChild variant="outline" className="w-full">
              <Link href="/junkyards">Browse yards</Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
