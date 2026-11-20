import { describe, expect, spyOn, test } from "bun:test";
import { reportConsumerTick } from "./consumer-report";

function harness(status = 200) {
  const events: string[] = [];
  const sentry = {
    info: (message: string, attributes: Record<string, unknown>) => {
      events.push(`info:${message}:${JSON.stringify(attributes)}`);
    },
    captureMessage: (message: string) => {
      events.push(`issue:${message}`);
      return "event-id";
    },
  };
  const fetchImpl = Object.assign(
    async (input: RequestInfo | URL) => {
      events.push(`ping:${String(input)}`);
      return new Response(null, { status });
    },
    { preconnect: fetch.preconnect },
  );
  return { events, sentry, fetchImpl };
}

const heartbeats = { maintenance: "https://example.com/hb" };

describe("reportConsumerTick", () => {
  test("logs the tick's result as a value and pings the heartbeat in production", async () => {
    const { events, sentry, fetchImpl } = harness();
    await reportConsumerTick({
      consumer: "maintenance",
      outcome: "succeeded",
      summary: { prunedRuns: 3, complete: true },
      heartbeats,
      production: true,
      sentry,
      fetchImpl,
    });
    expect(events).toEqual([
      'info:Downstream consumer maintenance tick:{"consumer":"maintenance","outcome":"succeeded","prunedRuns":3,"complete":true}',
      "ping:https://example.com/hb",
    ]);
  });

  test("opens a Sentry issue and reports the heartbeat failure for a failed tick", async () => {
    const { events, sentry, fetchImpl } = harness();
    await reportConsumerTick({
      consumer: "maintenance",
      outcome: "failed",
      summary: { status: "error" },
      heartbeats,
      production: true,
      sentry,
      fetchImpl,
    });
    expect(events.slice(1)).toEqual([
      "issue:Downstream consumer maintenance failed; its checkpoint stays behind and the next tick retries",
      "ping:https://example.com/hb/fail",
    ]);
  });

  test("pings nothing outside production and never throws on a rejected ping", async () => {
    const preview = harness();
    await reportConsumerTick({
      consumer: "maintenance",
      outcome: "succeeded",
      summary: {},
      heartbeats,
      production: false,
      sentry: preview.sentry,
      fetchImpl: preview.fetchImpl,
    });
    expect(preview.events.filter((event) => event.startsWith("ping"))).toEqual(
      [],
    );

    const rejected = harness(500);
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    try {
      await reportConsumerTick({
        consumer: "maintenance",
        outcome: "succeeded",
        summary: {},
        heartbeats,
        production: true,
        sentry: rejected.sentry,
        fetchImpl: rejected.fetchImpl,
      });
      expect(consoleError).toHaveBeenCalledTimes(1);
    } finally {
      consoleError.mockRestore();
    }
  });
});
