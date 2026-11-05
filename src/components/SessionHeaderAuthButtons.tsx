"use client";

import { HeaderAuthButtons } from "~/components/HeaderAuthButtons";
import { useSession } from "~/lib/auth-client";

/**
 * Header auth controls for pages served from the CDN, which can't read the
 * session while rendering. Until the session loads, an inert copy of the
 * signed-out controls holds their space so the header doesn't shift.
 */
export function SessionHeaderAuthButtons() {
  const { data, isPending } = useSession();

  if (isPending) {
    return (
      <div className="invisible" aria-hidden="true" inert>
        <HeaderAuthButtons user={null} />
      </div>
    );
  }

  return <HeaderAuthButtons user={data?.user ?? null} />;
}
