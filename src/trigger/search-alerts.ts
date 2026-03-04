import { logger, task, timeout } from "@trigger.dev/sdk";
import { runSearchAlerts } from "~/server/alerts/run-search-alerts";

export const vehicleSearchAlertsTask = task({
  id: "vehicle-search-alerts",
  maxDuration: timeout.None,
  queue: {
    concurrencyLimit: 1,
  },
  run: async () => {
    logger.info("Starting search alerts task");
    const result = await runSearchAlerts("trigger-task");
    logger.info("Completed search alerts task", {
      selected: result.selected,
      processed: result.processed,
    });
    return result;
  },
});
