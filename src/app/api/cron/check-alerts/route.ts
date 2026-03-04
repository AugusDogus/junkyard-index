import * as Sentry from "@sentry/nextjs";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "~/env";
import { runSearchAlerts } from "~/server/alerts/run-search-alerts";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runSearchAlerts("api-cron-route");
    return NextResponse.json(result);
  } catch (error) {
    console.error("Cron job failed:", error);
    Sentry.captureException(error, { tags: { context: "cron-check-alerts" } });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
