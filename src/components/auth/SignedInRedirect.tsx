"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "~/lib/auth-client";
import { ReturnTo } from "~/lib/return-to";

/**
 * Sends a signed-in visitor on from a sign-in or sign-up page. It runs in the
 * browser so the page reads nothing from the request and is served from the
 * CDN.
 */
export function SignedInRedirect() {
  const router = useRouter();
  const signedIn = Boolean(useSession().data);
  useEffect(() => {
    if (signedIn)
      router.replace(
        ReturnTo.forSignedIn(ReturnTo.fromSearch(window.location.search)),
      );
  }, [router, signedIn]);
  return null;
}
