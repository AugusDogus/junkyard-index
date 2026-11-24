import { revalidateTag } from "next/cache";
import pRetry from "p-retry";
import { start } from "workflow/api";
import { env } from "~/env";
import { db } from "~/lib/db";
import { INVENTORY_CACHE_TAG } from "~/lib/inventory-cache";
import { ConsumerFlags } from "~/server/ingestion/consumer-flags";
import { reportConsumerTickNow } from "~/server/ingestion/consumer-report-runtime";
import { InventoryDownstream } from "~/server/ingestion/inventory-downstream";
import { inventoryDownstreamTickOutcome } from "~/server/ingestion/inventory-downstream-consumer";
import { sourcesPastStalenessBoundary } from "~/server/ingestion/staleness-boundary";
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
 * gain "Last checked") or 7 days (it hides) since the last tick, which no
 * publication does. A failure here leaves the consumer to run as usual;
 * those labels and hides then wait for the next publication or the caches'
 * daily expiry.
 */
async function expireAtStalenessBoundary(): Promise<void> {
  try {
    const crossed = await sourcesPastStalenessBoundary(db, new Date());
    if (crossed.length === 0) return;
    revalidateTag(INVENTORY_CACHE_TAG, "max");
    console.info(
      `Expired the "${INVENTORY_CACHE_TAG}" cache tag because ${crossed.join(", ")} passed a staleness threshold (36 hours or 7 days without an accepted publication).`,
    );
  } catch (error) {
    console.error(
      `Could not check whether any source passed a staleness threshold; the inventory caches were not expired for it, so new "Last checked" labels and 7-day hides wait for the next publication or the caches' daily expiry. The inventory-downstream consumer still runs. The next hourly tick checks again.`,
      error,
    );
  }
}
