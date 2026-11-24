"use client";

import { useEffect } from "react";
import { SearchErrorFallback } from "~/components/search/SearchErrorFallback";
import { SearchPageBody } from "~/components/search/SearchPageBody";
import { ErrorReporting } from "~/lib/error-reporting";

export default function SearchError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    ErrorReporting.capture(error);
  }, [error]);
  return (
    <SearchPageBody>
      <SearchErrorFallback error={error} retry={reset} />
    </SearchPageBody>
  );
}
