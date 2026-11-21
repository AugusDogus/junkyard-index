import { env } from "~/env";
import type { DownstreamConsumer } from "./consumer-flags";
import {
  ConsumerHeartbeats,
  type ConsumerTickOutcome,
} from "./consumer-heartbeats";
import {
  reportConsumerTick,
  type ConsumerTickSummary,
} from "./consumer-report";

function configuredHeartbeats(): ConsumerHeartbeats {
  try {
    return ConsumerHeartbeats.parse(env.BETTERSTACK_CONSUMER_HEARTBEATS);
  } catch (error) {
    // The tick's work is settled; without a heartbeat its monitor turns red,
    // which surfaces the bad setting.
    console.error(String(error instanceof Error ? error.message : error));
    return {};
  }
}

/** Reports a consumer tick with this deployment's Sentry and heartbeats. */
export function reportConsumerTickNow(
  consumer: DownstreamConsumer,
  outcome: ConsumerTickOutcome,
  summary: ConsumerTickSummary,
  options?: { notify?: boolean },
): Promise<void> {
  return reportConsumerTick({
    notify: options?.notify,
    consumer,
    outcome,
    summary,
    heartbeats: configuredHeartbeats(),
    production: process.env.VERCEL_ENV === "production",
  });
}
