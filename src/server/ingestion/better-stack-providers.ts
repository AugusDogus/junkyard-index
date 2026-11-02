import { z } from "zod";
import {
  INGESTION_SOURCE_DISPLAY_NAMES,
  INGESTION_SOURCES,
  type IngestionSource,
} from "~/lib/ingestion-source";

const BETTER_STACK_API_URL = "https://uptime.betterstack.com/api/v2";
const PING_TIMEOUT_MS = 5_000;

const ProvidersSchema = z.record(
  z.enum(INGESTION_SOURCES),
  z.object({
    /** The provider's row on the public status page. */
    resourceId: z.number().int().positive(),
    /** Set for providers backed by a heartbeat; others use a monitor. */
    heartbeatUrl: z.string().url().optional(),
  }),
);

export type BetterStackProviders = z.infer<typeof ProvidersSchema>;

const idSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value));
const ReportListSchema = z.object({
  data: z.array(
    z.object({
      id: idSchema,
      attributes: z.object({
        affected_resources: z.array(
          z.object({
            status_page_resource_id: idSchema,
            status: z.enum(["resolved", "degraded", "downtime", "maintenance"]),
          }),
        ),
      }),
    }),
  ),
});

export type ProviderReportState = "published" | "retrying";

/**
 * The public status page shows a row per provider. Red comes from Better
 * Stack itself: a heartbeat stops (pinged after each accepted publication) or
 * a monitor of /api/status/<source> sees the inventory stale. Yellow is a
 * status report on the row while the latest attempt failed but the last good
 * inventory is still shown; it resolves on the next accepted publication.
 */
export const BetterStackProviders = {
  /** Parses BETTERSTACK_PROVIDERS: a JSON object of source to row settings. */
  parse(json: string | undefined): BetterStackProviders {
    if (json === undefined || json.trim() === "") return {};
    let value: unknown;
    try {
      value = JSON.parse(json);
    } catch (error) {
      throw new Error(
        `BETTERSTACK_PROVIDERS is not valid JSON (${error instanceof Error ? error.message : String(error)}). Set it to an object of ingestion source to { resourceId, heartbeatUrl? }.`,
      );
    }
    const parsed = ProvidersSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error(
        `BETTERSTACK_PROVIDERS must map ingestion sources to { resourceId, heartbeatUrl? }: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  },

  /** Reports a source run's outcome on the provider's status page row. */
  async report(params: {
    providers: BetterStackProviders;
    apiToken: string;
    statusPageId: number;
    source: IngestionSource;
    state: ProviderReportState;
    fetchImpl?: typeof fetch;
  }): Promise<void> {
    const provider = params.providers[params.source];
    if (!provider) return;
    const fetchImpl = params.fetchImpl ?? fetch;
    const name = INGESTION_SOURCE_DISPLAY_NAMES[params.source];
    if (params.state === "published" && provider.heartbeatUrl) {
      const response = await fetchImpl(provider.heartbeatUrl, {
        method: "HEAD",
        signal: AbortSignal.timeout(PING_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(
          `Pinging the ${name} Better Stack heartbeat returned HTTP ${response.status}; its status row turns red if pings stay missing for 30 hours.`,
        );
      }
    }

    const request = async (path: string, init?: RequestInit) => {
      const response = await fetchImpl(`${BETTER_STACK_API_URL}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${params.apiToken}`,
          "Content-Type": "application/json",
        },
      });
      if (!response.ok) {
        throw new Error(
          `Better Stack ${init?.method ?? "GET"} ${path} returned HTTP ${response.status} while reporting ${name}. The ingestion result is unaffected.`,
        );
      }
      const body: unknown = await response.json();
      return body;
    };
    const reportsPath = `/status-pages/${params.statusPageId}/status-reports`;
    const resourceId = String(provider.resourceId);
    const reports = ReportListSchema.parse(
      await request(`${reportsPath}?per_page=50`),
    );
    const open = reports.data.find((report) =>
      report.attributes.affected_resources.some(
        (resource) =>
          resource.status_page_resource_id === resourceId &&
          resource.status === "degraded",
      ),
    );
    if (params.state === "retrying") {
      if (open) return;
      await request(reportsPath, {
        method: "POST",
        body: JSON.stringify({
          title: `${name} update delayed`,
          message: `The latest ${name} inventory update did not complete. Junkyard Index still shows its last successful update and retries automatically.`,
          report_type: "manual",
          notify_subscribers: false,
          affected_resources: [
            { status_page_resource_id: resourceId, status: "degraded" },
          ],
        }),
      });
      return;
    }
    if (!open) return;
    await request(`${reportsPath}/${open.id}/status-updates`, {
      method: "POST",
      body: JSON.stringify({
        message: `${name} inventory updated successfully.`,
        notify_subscribers: false,
        affected_resources: [
          { status_page_resource_id: resourceId, status: "resolved" },
        ],
      }),
    });
  },
} as const;
