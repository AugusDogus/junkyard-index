import pRetry from "p-retry";
import { start } from "workflow/api";
import { env } from "~/env";
import { db } from "~/lib/db";
import { INVENTORY_CACHE_TAG } from "~/lib/inventory-cache";
import { expireInventoryCaches } from "~/lib/inventory-cache-expiry";
import { ConsumerFlags } from "~/server/ingestion/consumer-flags";
import { reportConsumerTickNow } from "~/server/ingestion/consumer-report-runtime";
import { InventoryDownstream } from "~/server/ingestion/inventory-downstream";
import { inventoryDownstreamTickOutcome } from "~/server/ingestion/inventory-downstream-consumer";
import { StalenessBoundary } from "~/server/ingestion/staleness-boundary";
import { hasValidCronAuthorization } from "~/server/workflows/cron-authorization";
import { workflowStartRetryOptions } from "~/server/workflows/start-retry";
import { inventoryDownstreamWorkflow } from "~/workflows/downstream-consumers";

export async function GET(request: Request) {
  if (
    !hasValidCronAuthorization(
      request.headers.get("authorization"),
      env.CRON_SECRET,
    )
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  await expireAtStalenessBoundary();

  // Starts the consumer only when a publication is due; the workflow checks
  // again and reports its own tick. Otherwise this tick is the report.
  try {
    const due = await InventoryDownstream.due(
      db,
      new Date(),
      await ConsumerFlags.mode("inventory-downstream"),
    );
    if (due.status === "due") {
      const run = await pRetry(
        () => start(inventoryDownstreamWorkflow, [due.checkedAt]),
        workflowStartRetryOptions,
      );
      return Response.json(
        { consumer: "inventory-downstream", due, workflowRunId: run.runId },
        { status: 202 },
      );
    }
    await reportConsumerTickNow(
      "inventory-downstream",
      inventoryDownstreamTickOutcome(due),
      due,
    );
    return Response.json({ consumer: "inventory-downstream", due });
  } catch (error) {
    await reportConsumerTickNow("inventory-downstream", "failed", {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Expires the inventory caches when a source passed 36 hours (its listings
 * gain "Last checked") or 7 days (it hides), or an ingestion outage began or
 * ended, since the last classification stored; no publication does then.
 * Those sources' per-yard entries expire too, and with them the CDN copies
 * of their yard model pages, which carry their source's tag. A
 * source coming back to current is left to its publication's refresh. A
 * failure here leaves the consumer to run as usual; those labels and hides
 * then wait for the next tick, publication or the caches' daily expiry.
 */
async function expireAtStalenessBoundary(): Promise<void> {
  try {
    const check = await StalenessBoundary.check({
      database: db,
      now: new Date(),
      revalidate: (changed) =>
        expireInventoryCaches(
          changed === "unknown"
            ? { kind: "all" }
            : { kind: "sources", sources: changed, yards: [] },
        ),
    });
    if (check.status === "unchanged") return;
    if (check.status === "recovered") {
      console.info(
        `Left the "${INVENTORY_CACHE_TAG}" cache tag to the inventory refresh: ${check.sources.join(", ")} published and came back to current, and that publication's refresh expires the caches.`,
      );
      return;
    }
    console.info(
      check.changed === "unknown"
        ? `Expired the "${INVENTORY_CACHE_TAG}" cache tag because no readable staleness classification was stored (checkpoint "${StalenessBoundary.checkpointName}"); it is stored now.`
        : `Expired the "${INVENTORY_CACHE_TAG}" cache tag because ${check.changed.join(", ")} changed staleness class (current, "Last checked" or hidden) since the last check.`,
    );
  } catch (error) {
    console.error(
      `Could not check whether any source changed staleness class (checkpoint "${StalenessBoundary.checkpointName}"); the inventory caches were not expired for it, so new "Last checked" labels and 7-day hides wait for the next tick, publication or the caches' daily expiry. Stored data is unchanged and the inventory-downstream consumer still runs; the next hourly tick checks again.`,
      error,
    );
  }
}
