"use client";

import Link from "next/link";
import { trackRequestYardClick } from "~/lib/track-request-yard-click";

export function TrackedRequestYardLink() {
  return (
    <Link
      href="/request-yard"
      className="hover:text-foreground transition-colors"
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
