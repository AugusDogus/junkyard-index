"use client";

import { LoaderCircle } from "lucide-react";
import { useLinkStatus } from "next/link";

/**
 * A spinner for inside an admin Link, shown from the click until the next
 * page (or its loading skeleton) is ready, so a click answers at once.
 */
export function AdminLinkPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <LoaderCircle
      aria-hidden
      className="text-muted-foreground size-3.5 shrink-0 motion-safe:animate-spin"
    />
  );
}
