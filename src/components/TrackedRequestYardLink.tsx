"use client";

import Link from "next/link";
import { trackRequestYardClick } from "~/lib/track-request-yard-click";

export function TrackedRequestYardLink({ className }: { className?: string }) {
  return (
    <Link
      href="/request-yard"
      className={className}
      onClick={() =>
        trackRequestYardClick({
          location: "footer",
          sourcePage: window.location.pathname,
        })
      }
    >
      Request a Yard
    </Link>
  );
}
