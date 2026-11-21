import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Signed-in visitors start at search, not the landing page. Checking only
 * that a session cookie exists (no database read) keeps the homepage a
 * static page served from the CDN; a stale cookie just lands on /search,
 * which works signed out too. Signed-in visitors see the yard map at /map,
 * which this proxy does not match.
 */
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/settings")) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(
      "x-settings-return-to",
      request.nextUrl.pathname + request.nextUrl.search,
    );
    return NextResponse.next({ request: { headers: requestHeaders } });
  }
  if (getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/search", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/", "/settings/:path*"] };
