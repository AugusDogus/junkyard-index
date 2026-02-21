import * as Sentry from "@sentry/nextjs";
import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "~/lib/db";
import { verifyUnsubscribeToken } from "~/lib/email";
import posthog from "~/lib/posthog-server";
import { savedSearch } from "~/schema";

// POST - One-click unsubscribe (required by Gmail/Yahoo List-Unsubscribe header)
export async function POST(request: NextRequest) {
  const searchId = request.nextUrl.searchParams.get("id");
  const token = request.nextUrl.searchParams.get("token");

  if (!searchId || !token || !verifyUnsubscribeToken(searchId, token)) {
    posthog.capture({
      distinctId: "anonymous",
      event: "email_unsubscribe_failed",
      properties: { reason: "invalid_token", search_id: searchId ?? "missing" },
    });
    return new NextResponse(null, { status: 400 });
  }

  try {
    const [updatedSearch] = await db
      .update(savedSearch)
      .set({ emailAlertsEnabled: false })
      .where(eq(savedSearch.id, searchId))
      .returning({ userId: savedSearch.userId });

    if (!updatedSearch) {
      posthog.capture({
        distinctId: "anonymous",
        event: "email_unsubscribe_failed",
        properties: { reason: "search_not_found", search_id: searchId },
      });
      return new NextResponse(null, { status: 404 });
    }

    posthog.capture({
      distinctId: updatedSearch.userId,
      event: "email_unsubscribed",
      properties: { search_id: searchId },
    });

    return new NextResponse(null, { status: 200 });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { context: "unsubscribe", searchId },
    });
    posthog.capture({
      distinctId: "anonymous",
      event: "email_unsubscribe_failed",
      properties: { reason: "server_error", search_id: searchId },
    });
    return new NextResponse(null, { status: 500 });
  }
}
