import { appendFileSync } from "node:fs";
import { NextResponse } from "next/server";

const DEBUG_LOG_PATH = "/opt/cursor/logs/debug.log";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      hypothesisId?: string;
      location?: string;
      message?: string;
      data?: unknown;
      timestamp?: number;
    };

    // #region agent log
    appendFileSync(
      DEBUG_LOG_PATH,
      JSON.stringify({
        hypothesisId: payload.hypothesisId ?? "unknown",
        location: payload.location ?? "unknown",
        message: payload.message ?? "unknown",
        data: payload.data ?? {},
        timestamp: payload.timestamp ?? Date.now(),
      }) + "\n",
    );
    // #endregion

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown debug log error",
      },
      { status: 500 },
    );
  }
}
