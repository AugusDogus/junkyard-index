import { describe, expect, test } from "bun:test";
import {
  syncIngestionStatusPage,
  type BetterStackStatusPageConfig,
  type StatusPageFetch,
} from "./better-stack-status-page";

const config: BetterStackStatusPageConfig = {
  apiToken: "test-token",
  statusPageId: 239393,
  resourceId: 8746061,
};

describe("Better Stack ingestion status page", () => {
  test("creates a degraded report for a partial publication", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl: StatusPageFetch = async (url, init) => {
      requests.push({ url, init });
      if (!init?.method || init.method === "GET") {
        return Response.json({ data: [] });
      }
      return Response.json({ data: { id: "123" } }, { status: 201 });
    };

    const result = await syncIngestionStatusPage({
      config,
      health: "degraded",
      fetchImpl,
    });

    expect(result).toEqual({ status: "reported" });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.init?.method).toBe("POST");
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({
      title: "Partial ingestion degradation",
      message:
        "Daily ingestion completed with partial source failures. Most inventory data was refreshed, but some yards may remain stale.",
      report_type: "manual",
      notify_subscribers: false,
      affected_resources: [
        { status_page_resource_id: "8746061", status: "degraded" },
      ],
    });
  });

  test("resolves an active degraded report after a healthy publication", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl: StatusPageFetch = async (url, init) => {
      requests.push({ url, init });
      if (!init?.method || init.method === "GET") {
        return Response.json({
          data: [
            {
              id: "123",
              attributes: {
                title: "Partial ingestion degradation",
                affected_resources: [
                  {
                    status_page_resource_id: "8746061",
                    status: "degraded",
                  },
                ],
              },
            },
          ],
        });
      }
      return Response.json({ data: { id: "456" } }, { status: 201 });
    };

    const result = await syncIngestionStatusPage({
      config,
      health: "healthy",
      fetchImpl,
    });

    expect(result).toEqual({ status: "reported" });
    expect(requests[1]?.url).toEndWith("/status-reports/123/status-updates");
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({
      message:
        "Daily ingestion completed successfully and full freshness was restored.",
      notify_subscribers: false,
      affected_resources: [
        { status_page_resource_id: "8746061", status: "resolved" },
      ],
    });
  });

  test("returns a failure value when Better Stack rejects the report", async () => {
    const fetchImpl: StatusPageFetch = async () =>
      new Response("unauthorized", { status: 401 });

    const result = await syncIngestionStatusPage({
      config,
      health: "degraded",
      fetchImpl,
    });

    expect(result.status).toBe("failed");
  });
});
