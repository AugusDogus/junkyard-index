import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { ConsumerMode } from "./consumer-flags";
import type { PublicationModeReading } from "./publication-mode-flag";
import {
  SearchIndexGenerations,
  type EnvironmentGenerations,
} from "./search-index-generation";
import { SearchOutbox } from "./search-outbox";
import { inlineWriterRuns } from "./search-projector";
import {
  SearchProjectorCheckpoint,
  type SearchProjectorCheckpointState,
} from "./search-projector-checkpoint";

/**
 * Search may trail Turso by this much before the status turns unhealthy:
 * the projector runs every 10 minutes and after every decoupled source run.
 */
export const SEARCH_LAG_THRESHOLD_MS = 2 * 60 * 60 * 1000;

export type SearchStatusInputs = {
  mode: PublicationModeReading;
  consumer: ConsumerMode;
  environment: string;
  generations: EnvironmentGenerations;
  checkpoint: SearchProjectorCheckpointState;
  horizon: number;
  /** When the oldest change the projector has not published was written. */
  oldestUnprojectedAt: Date | null;
  inlineWriterRunIds: string[];
};

type GenerationSummary = {
  id: string;
  status: string;
  reason: string;
  /** ISO time. */
  requestedAt: string;
} | null;

export type SearchStatus =
  /** Source runs publish search inline; the projector does nothing. */
  | { status: "inline"; mode: "inline" }
  | {
      status: "paused" | "healthy" | "unhealthy";
      /** unavailable: the mode flag could not be read; reported as unhealthy. */
      mode: "decoupled" | "unavailable";
      projectedThrough: number;
      horizon: number;
      /** Changes between the projector's checkpoint and the horizon. */
      lagChanges: number;
      /** Age of the oldest change not yet searchable; 0 when caught up. */
      lagMs: number;
      circuit: {
        state: "closed" | "open" | "half_open";
        lastErrorTag: string | null;
        failureCount: number;
        /** ISO time. */
        retryAt: string | null;
      };
      liveGeneration: GenerationSummary;
      activeGeneration: GenerationSummary;
      /** ISO time. */
      lastSuccessAt: string | null;
      inlineWriterRunIds: string[];
      problems: string[];
    };

function summary(
  generation: {
    id: string;
    status: string;
    reason: string;
    requestedAt: Date;
  } | null,
): GenerationSummary {
  return generation === null
    ? null
    : {
        id: generation.id,
        status: generation.status,
        reason: generation.reason,
        requestedAt: generation.requestedAt.toISOString(),
      };
}

/**
 * Search publication health for one Better Stack monitor: lag, the circuit
 * breaker, and the live generation. It reads Turso only, never Algolia.
 */
export const SearchStatus = {
  async load(
    database: LibSQLDatabase,
    params: {
      mode: PublicationModeReading;
      consumer: ConsumerMode;
      environment: string;
    },
  ): Promise<SearchStatusInputs> {
    const [generations, checkpoint, horizon, inlineWriterRunIds] =
      await Promise.all([
        SearchIndexGenerations.forEnvironment(database, params.environment),
        SearchProjectorCheckpoint.read(database),
        SearchOutbox.horizon(database),
        inlineWriterRuns(database),
      ]);
    const oldestUnprojectedAt = await SearchOutbox.oldestCreatedAt(database, {
      after: checkpoint.projectedThrough,
      through: horizon,
    });
    return {
      ...params,
      generations,
      checkpoint,
      horizon,
      oldestUnprojectedAt,
      inlineWriterRunIds,
    };
  },

  evaluate(inputs: SearchStatusInputs, now: Date): SearchStatus {
    if (inputs.mode === "inline") return { status: "inline", mode: "inline" };
    const { checkpoint, generations } = inputs;
    const circuit = SearchProjectorCheckpoint.circuit(checkpoint, now);
    const lagMs =
      inputs.oldestUnprojectedAt === null
        ? 0
        : Math.max(0, now.getTime() - inputs.oldestUnprojectedAt.getTime());
    const problems: string[] = [];
    if (inputs.mode === "unavailable") {
      problems.push(
        "The ingestion-publication-mode flag could not be read. Runs about to reconcile or project wait without writing (nothing is released or skipped), and the search projector waits too; both resume once the flag can be read again.",
      );
    }
    if (generations.status === "foreign") {
      problems.push(
        `The database's search generations belong to the ${generations.environment} deployment, not ${inputs.environment}; this deployment's projector refuses to write. Point this deployment at its own database, or end that environment's generations.`,
      );
    } else if (generations.live === null) {
      problems.push(
        "No live search generation describes the index; the projector writes nothing until a rebuild goes live.",
      );
    }
    // A short transient backoff is not an outage; lag catches a long one.
    if (
      circuit.state === "open" &&
      (SearchProjectorCheckpoint.isBlocking(circuit.tag) ||
        circuit.failureCount >= 3)
    ) {
      problems.push(
        `The projector's circuit is open after ${circuit.failureCount} ${circuit.tag} failure(s); it retries at ${circuit.retryAt.toISOString()}.`,
      );
    }
    if (inputs.inlineWriterRunIds.length > 0) {
      problems.push(
        `Runs still publish search inline (${inputs.inlineWriterRunIds.join(", ")}); the projector waits for them to release.`,
      );
    }
    if (lagMs > SEARCH_LAG_THRESHOLD_MS) {
      problems.push(
        `Search trails Turso by ${Math.round(lagMs / 60_000)} minutes, over the ${SEARCH_LAG_THRESHOLD_MS / 60_000} minute threshold.`,
      );
    }
    const status =
      inputs.consumer === "paused"
        ? "paused"
        : problems.length > 0
          ? "unhealthy"
          : "healthy";
    return {
      status,
      mode: inputs.mode,
      projectedThrough: checkpoint.projectedThrough,
      horizon: inputs.horizon,
      lagChanges: Math.max(0, inputs.horizon - checkpoint.projectedThrough),
      lagMs,
      circuit: {
        state: circuit.state,
        lastErrorTag: checkpoint.lastErrorTag,
        failureCount: checkpoint.failureCount,
        retryAt: checkpoint.blockedUntil?.toISOString() ?? null,
      },
      liveGeneration: summary(
        generations.status === "own" ? generations.live : null,
      ),
      activeGeneration: summary(
        generations.status === "own" ? generations.active : null,
      ),
      lastSuccessAt: checkpoint.lastSuccessAt?.toISOString() ?? null,
      inlineWriterRunIds: inputs.inlineWriterRunIds,
      problems,
    };
  },
} as const;
