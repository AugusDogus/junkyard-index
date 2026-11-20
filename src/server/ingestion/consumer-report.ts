import * as Sentry from "@sentry/nextjs";
import type { DownstreamConsumer } from "./consumer-flags";
import {
  ConsumerHeartbeats,
  type ConsumerTickOutcome,
} from "./consumer-heartbeats";

/** A consumer tick's result, flattened for Sentry attributes. */
export type ConsumerTickSummary = Readonly<
  Record<string, string | number | boolean | null>
>;

const FAILURE_CATEGORY = "downstream-consumer-failed";

/**
 * Reports one consumer tick as a value: a Sentry log for every tick, a Sentry
 * issue for a failed one, and the consumer's Better Stack heartbeat (in
 * production). Reporting never fails the tick; the consumer's work and its
 * checkpoint are already settled when this runs.
 */
export async function reportConsumerTick(params: {
  consumer: DownstreamConsumer;
  outcome: ConsumerTickOutcome;
  summary: ConsumerTickSummary;
  heartbeats: ConsumerHeartbeats;
  production: boolean;
  sentry?: {
    info(message: string, attributes: Record<string, unknown>): void;
    captureMessage: typeof Sentry.captureMessage;
  };
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const sentry = params.sentry ?? {
    info: (message: string, attributes: Record<string, unknown>) =>
      Sentry.logger.info(message, attributes),
    captureMessage: Sentry.captureMessage,
  };
  const attributes = {
    consumer: params.consumer,
    outcome: params.outcome,
    ...params.summary,
  };
  try {
    sentry.info(`Downstream consumer ${params.consumer} tick`, attributes);
    if (params.outcome === "failed") {
      sentry.captureMessage(
        `Downstream consumer ${params.consumer} failed; its checkpoint stays behind and the next tick retries`,
        {
          level: "error",
          fingerprint: [FAILURE_CATEGORY, params.consumer],
          tags: {
            failure_category: FAILURE_CATEGORY,
            downstream_consumer: params.consumer,
          },
          extra: attributes,
        },
      );
    }
  } catch (error) {
    console.error(
      `Could not report the ${params.consumer} consumer tick to Sentry`,
      error,
    );
  }
  if (!params.production) return;
  try {
    const heartbeat = await ConsumerHeartbeats.report({
      heartbeats: params.heartbeats,
      consumer: params.consumer,
      outcome: params.outcome,
      fetchImpl: params.fetchImpl,
    });
    if (heartbeat === "not_configured") {
      console.warn(
        `No Better Stack heartbeat is configured for the ${params.consumer} consumer; add it to BETTERSTACK_CONSUMER_HEARTBEATS so a stalled consumer pages.`,
      );
    }
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
  }
}
