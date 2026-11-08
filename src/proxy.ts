import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Signed-in visitors start at search, not the landing page. Checking only
 * that a session cookie exists (no database read) keeps the homepage a
 * static page served from the CDN; a stale cookie just lands on /search,
 * which works signed out too.
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/search", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: "/" };
