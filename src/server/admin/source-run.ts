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
  /**
   * The ingestion run's own errors. Commit failures and expired snapshots
   * are stored only here.
   */
  runErrors: string | null;
};

export const NO_SOURCE_RUN_ERRORS: SourceRunErrors = {
  errors: null,
  validationErrors: null,
  runErrors: null,
};

/**
 * How a run ended for its source. Accepted: its inventory is published (the
 * one meaning SourcePublication gives "published"). Rejected: it ended
 * without publishing, so the source's previous inventory stays live.
 */
export type RunOutcome =
  | { kind: "accepted"; publishedAt: Date }
  | { kind: "running" }
  | {
      kind: "rejected";
      reason: "error" | "validation" | "expired" | "superseded" | "unpublished";
    };

const REJECTION_FALLBACK = {
  error: "The run stopped with an error.",
  validation: "The data failed our checks, so it was not used.",
  expired:
    "It waited over 24 hours for its turn to publish, so nothing was published.",
  superseded:
    "Its day ended while it waited for its turn to publish, so the next day's crawl replaced it and nothing was published.",
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
    if (run.acceptanceStatus === "expired") {
      return { kind: "rejected", reason: "expired" };
    }
    if (run.acceptanceStatus === "superseded") {
      return { kind: "rejected", reason: "superseded" };
    }
    if (run.runStatus === "running") return { kind: "running" };
    return { kind: "rejected", reason: "unpublished" };
  },

  /**
   * Every stored message once: the source's errors, its validation errors,
   * then the ingestion run's errors (which often repeat the source's).
   */
  messages(errors: SourceRunErrors): string[] {
    return [
      ...new Set([
        ...ErrorText.messages(errors.errors),
        ...ErrorText.messages(errors.validationErrors),
        ...ErrorText.messages(errors.runErrors),
      ]),
    ];
  },

  /** A plain sentence on why a rejected run did not publish. */
  rejectionSummary(
    outcome: Extract<RunOutcome, { kind: "rejected" }>,
    errors: SourceRunErrors,
  ): string {
    // Their stored text names internal machinery; the fallback says it plainly.
    if (outcome.reason === "expired" || outcome.reason === "superseded")
      return REJECTION_FALLBACK[outcome.reason];
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
