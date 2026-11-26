"use client";

import Link from "next/link";
import { Button } from "~/components/ui/button";
import type { useYardLocation } from "~/hooks/use-yard-location";

export type YardLocationState = ReturnType<typeof useYardLocation>;

export function YardLocationFooter({
  location,
  requestLocation,
  locating,
  locationError,
}: YardLocationState) {
  return (
    <div className="border-rule-strong text-ink-2 border-t px-4 py-1.5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/junkyards"
          prefetch={false}
          className="hover:text-signal underline underline-offset-4"
        >
          {location ? "Nearest first" : "All yards"}
        </Link>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 px-2"
          disabled={locating}
          onClick={requestLocation}
        >
          {locating ? "Locating…" : "Use my location"}
        </Button>
      </div>
      {locationError && (
        <p role="status" className="mt-2 mb-1 text-pretty">
          {locationError}
        </p>
      )}
    </div>
  );
}
