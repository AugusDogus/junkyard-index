import { HookNotFoundError, RunExpiredError } from "workflow/internal/errors";
import { IngestionDay } from "~/server/ingestion/ingestion-day";
import type { IngestionRunReport } from "~/server/ingestion/ingestion-pass-orchestrator";
import { IngestionTokens } from "./ingestion-tokens";

/**
 * Sends a source run's report to the pass of the current ingestion day,
 * which plans the run even when an earlier day's pass started it. With no
 * pass listening the report is dropped: the next pass plans from the run's
 * database state. Any other failure is thrown so the step retries, since a
 * lost `fetched` or `yielded` report leaves lanes idle until the watchdog.
 */
export async function deliverPassReport(params: {
  report: Extract<IngestionRunReport, { runId: string }>;
  now: Date;
  resume: (token: string, report: IngestionRunReport) => Promise<unknown>;
}): Promise<"delivered" | "no_pass"> {
  try {
    await params.resume(
      IngestionTokens.passReports(IngestionDay.key(params.now)),
      params.report,
    );
    return "delivered";
  } catch (error) {
    if (HookNotFoundError.is(error) || RunExpiredError.is(error))
      return "no_pass";
    throw error;
  }
}
