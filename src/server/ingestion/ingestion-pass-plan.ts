import { isIngestionSource } from "~/lib/ingestion-source";
import { STOPPED_CHUNK_MS } from "./durable-ingestion-repository";
import type {
  DurableIngestionWakeupResult,
  DurableIngestionWakeupRun,
} from "./durable-ingestion-types";
import { HostClaims } from "./host-claims";
import type { IngestionPassPlan } from "./ingestion-pass-orchestrator";
import { SourceHostClaims } from "./source-host-claims";

/** What a run occupies (started) or needs to start (not started). */
function claimsOf(run: DurableIngestionWakeupRun): HostClaims {
  if (!run.fetching || !isIngestionSource(run.source)) return HostClaims.none;
  return run.attached
    ? SourceHostClaims.held(run.source, run.tenantsDone)
    : SourceHostClaims.next(run.source, run.tenantsDone);
}

/** The pass's plan for a wakeup, with each run's shared host claims. */
export function ingestionPassPlan(
  wakeup: DurableIngestionWakeupResult,
): IngestionPassPlan {
  if (wakeup.status !== "active") return wakeup;
  const freedAt = wakeup.stopped.map(
    (run) => run.releasedAt + STOPPED_CHUNK_MS,
  );
  return {
    status: "active",
    runs: wakeup.runs.map((run) => ({
      runId: run.runId,
      claims: claimsOf(run),
      started: run.attached,
    })),
    held: wakeup.stopped.flatMap((run) =>
      isIngestionSource(run.source) ? [SourceHostClaims.of(run.source)] : [],
    ),
    retryAt:
      wakeup.retryAt === null && freedAt.length === 0
        ? null
        : Math.min(
            ...freedAt,
            ...(wakeup.retryAt === null ? [] : [wakeup.retryAt]),
          ),
  };
}
