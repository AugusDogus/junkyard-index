import { z } from "zod";
import type { DownstreamConsumer } from "./consumer-flags";

const PING_TIMEOUT_MS = 5_000;

const HeartbeatsSchema = z
  .object({
    "inventory-downstream": z.string().url(),
    maintenance: z.string().url(),
    "notification-delivery": z.string().url(),
  } satisfies Record<DownstreamConsumer, z.ZodString>)
  .partial()
  .strict();

/** Each downstream consumer's Better Stack heartbeat URL, where one is set. */
export type ConsumerHeartbeats = z.infer<typeof HeartbeatsSchema>;

/**
 * How a consumer's tick ended. Succeeded covers a paused consumer and one
 * with nothing to do: its cron ran and its checks worked.
 */
export type ConsumerTickOutcome = "succeeded" | "failed";

/**
 * Each downstream consumer pings its own Better Stack heartbeat after every
 * tick, so one that stops running (or keeps failing) turns its monitor red
 * while the others stay green. A failed tick reports a failure at once
 * through the heartbeat's `/fail` endpoint.
 */
export const ConsumerHeartbeats = {
  /**
   * Parses BETTERSTACK_CONSUMER_HEARTBEATS: a JSON object of consumer name to
   * heartbeat URL. Unset means no consumer heartbeat is pinged.
   */
  parse(json: string | undefined): ConsumerHeartbeats {
    if (json === undefined || json.trim() === "") return {};
    let value: unknown;
    try {
      value = JSON.parse(json);
    } catch (error) {
      throw new Error(
        `BETTERSTACK_CONSUMER_HEARTBEATS is not valid JSON (${error instanceof Error ? error.message : String(error)}). Set it to an object of consumer name (inventory-downstream, maintenance, notification-delivery) to heartbeat URL.`,
      );
    }
    const parsed = HeartbeatsSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error(
        `BETTERSTACK_CONSUMER_HEARTBEATS must map consumer names (inventory-downstream, maintenance, notification-delivery) to heartbeat URLs: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  },

  /** Pings the consumer's heartbeat, or its failure endpoint. */
  async report(params: {
    heartbeats: ConsumerHeartbeats;
    consumer: DownstreamConsumer;
    outcome: ConsumerTickOutcome;
    fetchImpl?: typeof fetch;
  }): Promise<"reported" | "not_configured"> {
    const heartbeatUrl = params.heartbeats[params.consumer];
    if (!heartbeatUrl) return "not_configured";
    const url =
      params.outcome === "failed"
        ? `${heartbeatUrl.replace(/\/+$/, "")}/fail`
        : heartbeatUrl;
    const response = await (params.fetchImpl ?? fetch)(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(
        `Pinging the ${params.consumer} Better Stack heartbeat (${params.outcome}) returned HTTP ${response.status}; the consumer's own work is unaffected, but its monitor turns red if pings stay missing. Check the heartbeat URL in BETTERSTACK_CONSUMER_HEARTBEATS.`,
      );
    }
    return "reported";
  },
} as const;
