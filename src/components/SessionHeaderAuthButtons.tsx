"use client";

import dynamic from "next/dynamic";
import { HeaderAuthPlaceholder } from "~/components/HeaderAuthPlaceholder";

// The auth client (about 66 KB with its plugins) loads after the page
// hydrates instead of with it, so it never delays the first render.
const SessionAuthButtons = dynamic(
  () =>
    import("~/components/SessionAuthButtons").then(
      (module) => module.SessionAuthButtons,
    ),
  { ssr: false, loading: HeaderAuthPlaceholder },
);

/**
 * Header auth controls for pages served from the CDN, which can't read the
 * session while rendering. Until the session loads, the placeholder holds
 * the controls' space so the header doesn't shift.
 */
export function SessionHeaderAuthButtons() {
  return <SessionAuthButtons />;
}
