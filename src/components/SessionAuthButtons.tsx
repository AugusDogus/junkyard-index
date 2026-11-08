"use client";

import { HeaderAuthButtons } from "~/components/HeaderAuthButtons";
import { HeaderAuthPlaceholder } from "~/components/HeaderAuthPlaceholder";
import { useSession } from "~/lib/auth-client";

/** The header controls for whoever the session says is signed in. */
export function SessionAuthButtons() {
  const { data, isPending } = useSession();
  if (isPending) return <HeaderAuthPlaceholder />;
  return <HeaderAuthButtons user={data?.user ?? null} />;
}
