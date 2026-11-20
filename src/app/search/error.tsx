"use client";

import { useEffect } from "react";
import { SearchErrorFallback } from "~/components/search/SearchErrorFallback";
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
  return <SearchErrorFallback error={error} retry={reset} />;
}
