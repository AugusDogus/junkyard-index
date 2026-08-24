import { z } from "zod";
import type { DurableIngestionHealth } from "./durable-health";

const BETTER_STACK_API_URL = "https://uptime.betterstack.com/api/v2";
const DEGRADATION_REPORT_TITLE = "Partial ingestion degradation";

const resourceIdSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value));

const reportListSchema = z.object({
  data: z.array(
    z.object({
      id: resourceIdSchema,
      attributes: z.object({
        title: z.string(),
        affected_resources: z.array(
          z.object({
            status_page_resource_id: resourceIdSchema,
            status: z.enum(["resolved", "degraded", "downtime", "maintenance"]),
          }),
        ),
      }),
    }),
  ),
});

const writeResponseSchema = z.object({
  data: z.object({ id: resourceIdSchema }),
});

export interface BetterStackStatusPageConfig {
  apiToken: string;
  statusPageId: number;
  resourceId: number;
}

export type StatusPageFetch = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

type StatusPageOperation = "list_reports" | "create_report" | "resolve_report";

export type StatusPageSyncResult =
  | { status: "reported" }
  | { status: "failed"; operation: StatusPageOperation; message: string };

type JsonRequestResult =
  | { status: "success"; body: unknown }
  | { status: "failed"; message: string };

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function requestJson(
  fetchImpl: StatusPageFetch,
  config: BetterStackStatusPageConfig,
  path: string,
  init?: RequestInit,
): Promise<JsonRequestResult> {
  try {
    const response = await fetchImpl(`${BETTER_STACK_API_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
    const text = await response.text();
    let body: unknown = null;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (!response.ok) {
      return {
        status: "failed",
        message: `Better Stack responded with HTTP ${response.status}.`,
      };
    }
    return { status: "success", body };
  } catch (error) {
    return {
      status: "failed",
      message: `Better Stack request failed: ${getErrorMessage(error)}`,
    };
  }
}

function failedResult(
  operation: StatusPageOperation,
  message: string,
): StatusPageSyncResult {
  return { status: "failed", operation, message };
}

export async function syncIngestionStatusPage(params: {
  config: BetterStackStatusPageConfig;
  health: DurableIngestionHealth;
  fetchImpl?: StatusPageFetch;
}): Promise<StatusPageSyncResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const reportsPath = `/status-pages/${params.config.statusPageId}/status-reports`;
  const listed = await requestJson(
    fetchImpl,
    params.config,
    `${reportsPath}?per_page=50`,
  );
  if (listed.status === "failed") {
    return failedResult("list_reports", listed.message);
  }

  const parsedReports = reportListSchema.safeParse(listed.body);
  if (!parsedReports.success) {
    return failedResult(
      "list_reports",
      "Better Stack returned an invalid status report list.",
    );
  }

  const resourceId = String(params.config.resourceId);
  const activeReport = parsedReports.data.data.find(
    (report) =>
      report.attributes.title === DEGRADATION_REPORT_TITLE &&
      report.attributes.affected_resources.some(
        (resource) =>
          resource.status_page_resource_id === resourceId &&
          resource.status === "degraded",
      ),
  );

  if (params.health === "degraded") {
    if (activeReport) return { status: "reported" };
    const created = await requestJson(fetchImpl, params.config, reportsPath, {
      method: "POST",
      body: JSON.stringify({
        title: DEGRADATION_REPORT_TITLE,
        message:
          "Daily ingestion completed with partial source failures. Most inventory data was refreshed, but some yards may remain stale.",
        report_type: "manual",
        notify_subscribers: false,
        affected_resources: [
          { status_page_resource_id: resourceId, status: "degraded" },
        ],
      }),
    });
    if (created.status === "failed") {
      return failedResult("create_report", created.message);
    }
    if (!writeResponseSchema.safeParse(created.body).success) {
      return failedResult(
        "create_report",
        "Better Stack returned an invalid created report.",
      );
    }
    return { status: "reported" };
  }

  if (!activeReport) return { status: "reported" };

  const message =
    params.health === "healthy"
      ? "Daily ingestion completed successfully and full freshness was restored."
      : "The partial refresh ended when ingestion stopped before publication. Availability monitoring now reflects the outage.";
  const resolved = await requestJson(
    fetchImpl,
    params.config,
    `${reportsPath}/${activeReport.id}/status-updates`,
    {
      method: "POST",
      body: JSON.stringify({
        message,
        notify_subscribers: false,
        affected_resources: [
          { status_page_resource_id: resourceId, status: "resolved" },
        ],
      }),
    },
  );
  if (resolved.status === "failed") {
    return failedResult("resolve_report", resolved.message);
  }
  if (!writeResponseSchema.safeParse(resolved.body).success) {
    return failedResult(
      "resolve_report",
      "Better Stack returned an invalid status update.",
    );
  }
  return { status: "reported" };
}
