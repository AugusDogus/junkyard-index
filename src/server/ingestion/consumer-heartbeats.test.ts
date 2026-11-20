import { describe, expect, test } from "bun:test";
import { ConsumerHeartbeats } from "./consumer-heartbeats";

function recordingFetch(status = 200) {
  const calls: Array<{ url: string; method: string | undefined }> = [];
  const fetchImpl = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method });
      return new Response(null, { status });
    },
    { preconnect: fetch.preconnect },
  );
  return { calls, fetchImpl };
}

describe("ConsumerHeartbeats", () => {
  test("parses a consumer to heartbeat URL map and rejects unknown consumers", () => {
    expect(ConsumerHeartbeats.parse(undefined)).toEqual({});
    expect(
      ConsumerHeartbeats.parse(
        '{"maintenance":"https://uptime.betterstack.com/api/v1/heartbeat/abc"}',
      ),
    ).toEqual({
      maintenance: "https://uptime.betterstack.com/api/v1/heartbeat/abc",
    });
    expect(() =>
      ConsumerHeartbeats.parse('{"search":"https://example.com"}'),
    ).toThrow(/BETTERSTACK_CONSUMER_HEARTBEATS must map/);
    expect(() => ConsumerHeartbeats.parse("{")).toThrow(/not valid JSON/);
  });

  test("pings success, reports failure on /fail, and skips unconfigured consumers", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const heartbeats = {
      "inventory-downstream":
        "https://uptime.betterstack.com/api/v1/heartbeat/inv",
    };
    expect(
      await ConsumerHeartbeats.report({
        heartbeats,
        consumer: "inventory-downstream",
        outcome: "succeeded",
        fetchImpl,
      }),
    ).toBe("reported");
    await ConsumerHeartbeats.report({
      heartbeats,
      consumer: "inventory-downstream",
      outcome: "failed",
      fetchImpl,
    });
    expect(
      await ConsumerHeartbeats.report({
        heartbeats,
        consumer: "maintenance",
        outcome: "succeeded",
        fetchImpl,
      }),
    ).toBe("not_configured");
    expect(calls).toEqual([
      {
        url: "https://uptime.betterstack.com/api/v1/heartbeat/inv",
        method: "HEAD",
      },
      {
        url: "https://uptime.betterstack.com/api/v1/heartbeat/inv/fail",
        method: "HEAD",
      },
    ]);
  });

  test("throws a recoverable error when Better Stack rejects the ping", async () => {
    const { fetchImpl } = recordingFetch(404);
    await expect(
      ConsumerHeartbeats.report({
        heartbeats: { maintenance: "https://example.com/hb" },
        consumer: "maintenance",
        outcome: "succeeded",
        fetchImpl,
      }),
    ).rejects.toThrow(/HTTP 404/);
  });
});
