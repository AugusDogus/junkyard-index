import { ErrorText } from "./error-text";

/** One source's part of an ingestion run, as the admin dashboard reads it. */
export type SourceRun = {
  id: string;
  runId: string;
  source: string;
  /** The source run's own status: running, success, error or partial. */
  status: string;
  /** pending, accepted or rejected by validation. */
  acceptanceStatus: string;
  /** The ingestion run's status: running, success, error or abandoned. */
  runStatus: string;
  stage: string;
  startedAt: Date;
  completedAt: Date | null;
  inventoryPublishedAt: Date | null;
  pagesProcessed: number;
  vehiclesProcessed: number;
  uniqueVehicles: number;
  duplicateVehicles: number;
  rejectedVehicles: number;
};

/** A run's stored error text: whole on a run's page, an excerpt in lists. */
export type SourceRunErrors = {
  errors: string | null;
  validationErrors: string | null;
};

/**
 * How a run ended for its source. Accepted: its inventory is published (the
 * one meaning SourcePublication gives "published"). Rejected: it ended
 * without publishing, so the source's previous inventory stays live.
 */
export type RunOutcome =
  | { kind: "accepted"; publishedAt: Date }
  | { kind: "running" }
  | { kind: "rejected"; reason: "error" | "validation" | "unpublished" };

const REJECTION_FALLBACK = {
  error: "The run stopped with an error.",
  validation: "The data failed our checks, so it was not used.",
  unpublished: "The run ended without publishing.",
} as const;

export const SourceRun = {
  outcome(run: SourceRun): RunOutcome {
    if (
      run.status === "success" &&
      run.acceptanceStatus === "accepted" &&
      run.inventoryPublishedAt !== null
    ) {
      return { kind: "accepted", publishedAt: run.inventoryPublishedAt };
    }
    if (run.status === "error") return { kind: "rejected", reason: "error" };
    if (run.acceptanceStatus === "rejected") {
      return { kind: "rejected", reason: "validation" };
    }
    if (run.runStatus === "running") return { kind: "running" };
    return { kind: "rejected", reason: "unpublished" };
  },

  /** Every stored message, the run's errors before its validation errors. */
  messages(errors: SourceRunErrors): string[] {
    return [
      ...ErrorText.messages(errors.errors),
      ...ErrorText.messages(errors.validationErrors),
    ];
  },

  /** A plain sentence on why a rejected run did not publish. */
  rejectionSummary(
    outcome: Extract<RunOutcome, { kind: "rejected" }>,
    errors: SourceRunErrors,
  ): string {
    return (
      ErrorText.summary(SourceRun.messages(errors)) ??
      REJECTION_FALLBACK[outcome.reason]
    );
  },

  durationMs(run: SourceRun): number | null {
    return run.completedAt === null
      ? null
      : run.completedAt.getTime() - run.startedAt.getTime();
  },
} as const;
