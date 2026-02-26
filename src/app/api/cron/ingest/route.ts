import * as Sentry from "@sentry/nextjs";
import { waitUntil } from "@vercel/functions";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "~/env";
import {
  type IngestionContinuationState,
  runIngestionStep,
} from "~/server/ingestion/run";

export const maxDuration = 800;
const DISPATCH_ACK_TIMEOUT_MS = 4000;

function parseNumber(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

function parseContinuationState(
  request: NextRequest,
): IngestionContinuationState | undefined {
  const params = request.nextUrl.searchParams;
  const cycleId = params.get("cycleId");
  if (!cycleId) return undefined;

  const cycleStartedAtMs = parseNumber(
    params.get("cycleStartedAtMs"),
    Date.now(),
  );
  const row52Skip = parseNumber(params.get("row52Skip"), 0);
  const pypPage = parseNumber(params.get("pypPage"), 1);
  const totalUpserted = parseNumber(params.get("totalUpserted"), 0);
  const row52Done = parseBoolean(params.get("row52Done"), false);
  const pypDone = parseBoolean(params.get("pypDone"), false);
  const row52TotalCountParam = params.get("row52TotalCount");
  const row52TotalCount = row52TotalCountParam
    ? parseNumber(row52TotalCountParam, 0)
    : undefined;

  return {
    cycleId,
    cycleStartedAtMs,
    row52Skip,
    row52TotalCount,
    row52Done,
    pypPage,
    pypDone,
    totalUpserted,
  };
}

function buildContinuationUrl(
  request: NextRequest,
  state: IngestionContinuationState,
): URL {
  const url = new URL(request.nextUrl.pathname, request.nextUrl.origin);
  url.searchParams.set("cycleId", state.cycleId);
  url.searchParams.set("cycleStartedAtMs", String(state.cycleStartedAtMs));
  url.searchParams.set("row52Skip", String(state.row52Skip));
  if (state.row52TotalCount !== undefined) {
    url.searchParams.set("row52TotalCount", String(state.row52TotalCount));
  }
  url.searchParams.set("row52Done", state.row52Done ? "1" : "0");
  url.searchParams.set("pypPage", String(state.pypPage));
  url.searchParams.set("pypDone", state.pypDone ? "1" : "0");
  url.searchParams.set("totalUpserted", String(state.totalUpserted));
  return url;
}

async function dispatchContinuation(
  request: NextRequest,
  state: IngestionContinuationState,
): Promise<void> {
  const url = buildContinuationUrl(request, state);
  const abortController = new AbortController();
  const timer = setTimeout(
    () => abortController.abort(),
    DISPATCH_ACK_TIMEOUT_MS,
  );

  try {
    await fetch(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${env.CRON_SECRET}`,
        "x-ingest-continuation": "1",
      },
      cache: "no-store",
      signal: abortController.signal,
    });
  } catch (error) {
    if (!(error instanceof Error && error.name === "AbortError")) {
      throw error;
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: NextRequest) {
  // Verify the request is from Vercel Cron
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const state = parseContinuationState(request);
    const stepLabel = state ? "continuation" : "start";
    console.log(`[Ingest Cron] Starting ingestion step (${stepLabel})...`);

    const result = await runIngestionStep(state);
    let continuationScheduled = false;
    if (result.status === "in_progress" && result.state) {
      waitUntil(dispatchContinuation(request, result.state));
      continuationScheduled = true;
      console.log(
        `[Ingest Cron] Scheduled continuation for cycle ${result.state.cycleId}`,
      );
    }

    console.log(
      `[Ingest Cron] Step complete: status=${result.status} upserted=${result.totalUpserted} deleted=${result.totalDeleted} duration=${result.durationMs}ms`,
    );

    const body = {
      message:
        result.status === "completed"
          ? "Ingestion cycle complete"
          : "Ingestion step complete",
      continuationScheduled,
      ...result,
    };
    if (result.status === "error") {
      return NextResponse.json(body, { status: 500 });
    }

    return NextResponse.json(body);
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
