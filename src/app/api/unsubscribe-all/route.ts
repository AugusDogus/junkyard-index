import * as Sentry from "@sentry/nextjs";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "~/lib/db";
import { verifyUserUnsubscribeToken } from "~/lib/email";
import posthog from "~/lib/posthog-server";
import { setUserAlertChannel } from "~/server/alerts/alert-config-repository";

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
    const disabledSearchIds = await setUserAlertChannel({
      database: db,
      userId,
      channel: "email",
      enabled: false,
    });

    posthog.capture({
      distinctId: userId,
      event: "email_unsubscribed_all",
      properties: { disabled_search_count: disabledSearchIds.length },
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
