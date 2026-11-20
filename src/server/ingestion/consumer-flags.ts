import { flagsClient, Reason, type EvaluationResult } from "@vercel/flags-core";

/**
 * A downstream job that runs on its own cron with its own checkpoint, so a
 * stalled ingestion pass or a blocked search backend cannot hold it back.
 */
export type DownstreamConsumer =
  | "inventory-downstream"
  | "maintenance"
  | "notification-delivery";

export type ConsumerMode = "enabled" | "paused";

// Vercel Flags pause a downstream consumer without a deploy. Serve false for
// its `consumer-<name>` boolean flag to pause it; a paused consumer does no
// work and keeps its checkpoint, so it resumes where it stopped. A missing
// flag, a failed evaluation or a non-boolean value keeps it enabled, mirroring
// ingestion-source-flags.ts. New Vercel flags serve false in production, so
// creating one pauses its consumer immediately. Saved-search alerts are not
// governed by this: they also need the fail-closed `search-alerts-enabled`.
export const ConsumerFlags = {
  key(consumer: DownstreamConsumer): string {
    return `consumer-${consumer}`;
  },

  resolve(
    consumer: DownstreamConsumer,
    result: EvaluationResult<unknown>,
  ): ConsumerMode {
    const key = ConsumerFlags.key(consumer);
    if (result.reason === Reason.ERROR) {
      if (result.errorCode !== "FLAG_NOT_FOUND") {
        console.error(
          `Could not evaluate Vercel flag ${key}; running ${consumer} as enabled: ${result.errorMessage}`,
        );
      }
      return "enabled";
    }
    if (typeof result.value !== "boolean") {
      console.error(
        `Vercel flag ${key} served ${JSON.stringify(result.value)}, not a boolean; running ${consumer} as enabled. Make it a boolean flag.`,
      );
      return "enabled";
    }
    return result.value ? "enabled" : "paused";
  },

  /** The consumer's current mode. Read it where the consumer's work starts. */
  async mode(consumer: DownstreamConsumer): Promise<ConsumerMode> {
    const key = ConsumerFlags.key(consumer);
    let result: EvaluationResult<unknown>;
    try {
      result = await flagsClient.evaluate<unknown>(key, true);
    } catch (error) {
      console.error(
        `Could not evaluate Vercel flag ${key}; running ${consumer} as enabled`,
        error,
      );
      return "enabled";
    }
    return ConsumerFlags.resolve(consumer, result);
  },
} as const;
