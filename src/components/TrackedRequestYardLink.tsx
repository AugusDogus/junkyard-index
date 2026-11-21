"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { trackRequestYardClick } from "~/lib/track-request-yard-click";

/**
 * The footer's Request a Yard link. It forwards the rest of its props so the
 * account menu can render it as a Radix menu item (`asChild`) and keep the
 * same click tracking.
 */
export function TrackedRequestYardLink({
  onClick,
  ...props
}: Omit<ComponentProps<typeof Link>, "href" | "children">) {
  return (
    <Link
      {...props}
      href="/request-yard"
      onClick={(event) => {
        trackRequestYardClick({
          location: "footer",
          sourcePage: window.location.pathname,
        });
        onClick?.(event);
      }}
    >
      Request a Yard
    </Link>
  );
}
