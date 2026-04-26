"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "~/components/ui/button";
import { debugLogClient } from "~/lib/debug-log-client";

export default function SearchError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // #region agent log
    debugLogClient({
      hypothesisId: "E",
      location: "src/app/search/error.tsx:11",
      message: "Search route error boundary rendered",
      data: {
        name: error.name,
        message: error.message,
        digest: error.digest,
      },
    });
    // #endregion
  }, [error]);

  return (
    <div className="flex min-h-[400px] items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl border p-6">
        <div className="mb-4 flex items-center gap-2">
          <AlertTriangle className="text-destructive h-5 w-5" />
          <h2 className="text-lg font-semibold">Search unavailable</h2>
        </div>
        <p className="text-muted-foreground text-sm">
          Something interrupted the search page. Try again.
        </p>
        <div className="mt-4 space-y-2">
          <Button onClick={reset} className="w-full">
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry Search
          </Button>
          <Button
            variant="outline"
            onClick={() => window.location.reload()}
            className="w-full"
          >
            Reload Page
          </Button>
        </div>
      </div>
    </div>
  );
}
