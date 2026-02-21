import * as Sentry from "@sentry/nextjs";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "~/env";
import { runIngestion } from "~/server/ingestion/run";

export const maxDuration = 300; // 5 minutes

export async function GET(request: NextRequest) {
  // Verify the request is from Vercel Cron
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log("[Ingest Cron] Starting ingestion pipeline...");

    const result = await runIngestion();

    console.log(
      `[Ingest Cron] Complete: ${result.totalUpserted} upserted, ${result.totalDeleted} deleted in ${result.durationMs}ms`,
    );

    return NextResponse.json({
      message: "Ingestion complete",
      ...result,
    });
  } catch (error) {
    console.error("[Ingest Cron] Failed:", error);
    Sentry.captureException(error, {
      tags: { context: "cron-ingest" },
    });

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
