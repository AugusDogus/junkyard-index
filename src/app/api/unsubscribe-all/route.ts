import * as Sentry from "@sentry/nextjs";
import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "~/lib/db";
import { verifyUserUnsubscribeToken } from "~/lib/email";
import posthog from "~/lib/posthog-server";
import { savedSearch } from "~/schema";

export async function POST(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("id");
  const token = request.nextUrl.searchParams.get("token");

  if (!userId || !token || !verifyUserUnsubscribeToken(userId, token)) {
    posthog.capture({
      distinctId: "anonymous",
      event: "email_unsubscribe_all_failed",
      properties: { reason: "invalid_token" },
    });
    return new NextResponse(null, { status: 400 });
  }

  try {
    const disabledSearches = await db
      .update(savedSearch)
      .set({ emailAlertsEnabled: false })
      .where(eq(savedSearch.userId, userId))
      .returning({ id: savedSearch.id });

    posthog.capture({
      distinctId: userId,
      event: "email_unsubscribed_all",
      properties: { disabled_search_count: disabledSearches.length },
    });

    return new NextResponse(null, { status: 200 });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { context: "unsubscribe-all", userId },
    });
    posthog.capture({
      distinctId: userId,
      event: "email_unsubscribe_all_failed",
      properties: { reason: "server_error" },
    });
    return new NextResponse(null, { status: 500 });
  }
}
