import { describe, expect, test } from "bun:test";
import { BetterStackProviders } from "./better-stack-providers";

const HEARTBEAT = "https://uptime.betterstack.com/api/v1/heartbeat/abc";
const providers = BetterStackProviders.parse(
  JSON.stringify({
    pyp: { resourceId: 101, heartbeatUrl: HEARTBEAT },
    tearapart: { resourceId: 202 },
  }),
);

function betterStack(openReportResourceIds: number[]) {
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body: unknown =
      typeof init?.body === "string" ? JSON.parse(init.body) : null;
    requests.push({ method, url, body });
    if (method === "GET" && url.includes("/status-reports")) {
      return Response.json({
        data: openReportResourceIds.map((resourceId, index) => ({
          id: `report-${index}`,
          attributes: {
            affected_resources: [
              { status_page_resource_id: resourceId, status: "degraded" },
            ],
          },
        })),
      });
    }
    return Response.json({ data: { id: "written" } });
  };
  return {
    requests,
    report: (
      source: "pyp" | "tearapart" | "row52",
      state: "published" | "retrying",
    ) =>
      BetterStackProviders.report({
        providers,
        apiToken: "token",
        statusPageId: 239393,
        source,
        state,
        fetchImpl: Object.assign(fetchImpl, { preconnect: fetch.preconnect }),
      }),
  };
}

describe("BetterStackProviders.report", () => {
  test("opens one delay report while a provider retries", async () => {
    const fresh = betterStack([]);
    await fresh.report("pyp", "retrying");
    expect(fresh.requests.map((r) => r.method)).toEqual(["GET", "POST"]);
    expect(fresh.requests[1]?.body).toMatchObject({
      title: "LKQ Pick Your Part update delayed",
      affected_resources: [
        { status_page_resource_id: "101", status: "degraded" },
      ],
    });

    const alreadyOpen = betterStack([101]);
    await alreadyOpen.report("pyp", "retrying");
    expect(alreadyOpen.requests.map((r) => r.method)).toEqual(["GET"]);
  });

  test("pings the heartbeat and resolves the delay after a good publication", async () => {
    const betterStackApi = betterStack([101]);
    await betterStackApi.report("pyp", "published");
    expect(betterStackApi.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `HEAD ${HEARTBEAT}`,
      "GET https://uptime.betterstack.com/api/v2/status-pages/239393/status-reports?per_page=50",
      "POST https://uptime.betterstack.com/api/v2/status-pages/239393/status-reports/report-0/status-updates",
    ]);
    expect(betterStackApi.requests[2]?.body).toMatchObject({
      affected_resources: [
        { status_page_resource_id: "101", status: "resolved" },
      ],
    });
  });

  test("skips the ping for monitor-backed providers and ignores unconfigured ones", async () => {
    const monitored = betterStack([]);
    await monitored.report("tearapart", "published");
    expect(monitored.requests.map((r) => r.method)).toEqual(["GET"]);

    const unconfigured = betterStack([]);
    await unconfigured.report("row52", "retrying");
    expect(unconfigured.requests).toEqual([]);
  });
});

describe("BetterStackProviders.parse", () => {
  test("rejects malformed provider settings", () => {
    expect(() => BetterStackProviders.parse("{")).toThrow("not valid JSON");
    expect(() =>
      BetterStackProviders.parse(JSON.stringify({ pyp: { resourceId: "x" } })),
    ).toThrow("BETTERSTACK_PROVIDERS");
    expect(BetterStackProviders.parse(undefined)).toEqual({});
  });
});
