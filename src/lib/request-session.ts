import { cache } from "react";
import type { ReadonlyHeaders } from "next/dist/server/web/spec-extension/adapters/headers";
import { auth } from "~/lib/auth";

const BETTER_AUTH_SESSION_COOKIE_PATTERN =
  /(?:^|;\s)(?:__Secure-)?better-auth\.session_(?:token|data)=/;

function hasBetterAuthSessionCookie(cookieHeader: string | null) {
  return cookieHeader !== null && BETTER_AUTH_SESSION_COOKIE_PATTERN.test(cookieHeader);
}

export const getRequestSession = cache(
  async (cookieHeader: string | null, reqHeaders: ReadonlyHeaders) => {
    if (!hasBetterAuthSessionCookie(cookieHeader)) {
      return null;
    }

    return auth.api.getSession({ headers: reqHeaders });
  },
);
