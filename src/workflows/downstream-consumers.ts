import { createHook, sleep } from "workflow";
import {
  runInventoryDownstream,
  type InventoryDownstreamResult,
} from "~/server/ingestion/inventory-downstream-consumer";
import { IngestionTokens } from "./ingestion-tokens";
import {
  announceInventoryStep,
  inventoryDownstreamDueStep,
  recordInventoryDownstreamStep,
  refreshInventoryCachesStep,
  reportConsumerTickStep,
  warmInventoryAnnouncementStep,
} from "./downstream-steps";

// Time for requested pages to finish regenerating in the background.
const PAGE_REGENERATION_DELAY = "2m";

/**
 * The inventory-downstream consumer: the hourly cron starts it when a Turso
 * publication is newer than its checkpoint and the last refresh is at least
 * 3 hours old. It refreshes the homepage snapshot and inventory caches, warms
 * the changed pages and announces them to IndexNow. It never depends on an
 * ingestion pass completing or on search.
 */
export async function inventoryDownstreamWorkflow() {
  "use workflow";

  using consumer = createHook({
    token: IngestionTokens.consumer("inventory-downstream"),
  });
  const activeConsumer = await consumer.getConflict();
  if (activeConsumer) {
    return {
      status: "deduplicated" as const,
      activeRunId: activeConsumer.runId,
    };
  }
  let result: InventoryDownstreamResult;
  try {
    result = await runInventoryDownstream({
      due: inventoryDownstreamDueStep,
      refresh: refreshInventoryCachesStep,
      warm: warmInventoryAnnouncementStep,
      waitForPages: () => sleep(PAGE_REGENERATION_DELAY),
      announce: announceInventoryStep,
      record: recordInventoryDownstreamStep,
    });
  } catch (error) {
    await reportConsumerTickStep("inventory-downstream", "failed", {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  await reportConsumerTickStep(
    "inventory-downstream",
    result.status === "refresh_failed" ? "failed" : "succeeded",
    result,
  );
  return result;
}
