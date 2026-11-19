import { createHook, sleep } from "workflow";
import { IngestionTokens } from "./ingestion-tokens";
import { searchRebuildInFlightStep } from "./search-projector-steps";
import {
  finalizeSearchIndexMigrationStep,
  initializeSearchIndexMigrationStep,
  runSearchIndexMigrationBatchStep,
} from "./vehicle-steps";

const MIGRATION_RUN_TOKEN = "search-index-schema-migration";
const LOCK_RETRY_DELAY = "30s";

export async function searchIndexMigrationWorkflow(force = false) {
  "use workflow";

  using migrationRun = createHook({ token: MIGRATION_RUN_TOKEN });
  const activeRun = await migrationRun.getConflict();
  if (activeRun) {
    return {
      status: "deduplicated" as const,
      activeRunId: activeRun.runId,
    };
  }

  while (true) {
    using algoliaWrites = createHook({ token: IngestionTokens.algoliaWrites });
    const activeWriter = await algoliaWrites.getConflict();
    if (activeWriter) {
      console.info(
        `[Workflow] Waiting for Algolia writer ${activeWriter.runId}`,
      );
      await sleep(LOCK_RETRY_DELAY);
      continue;
    }
    // The search projector writes the same index; wait for it to finish.
    using projector = createHook({ token: IngestionTokens.searchProjector });
    const activeProjector = await projector.getConflict();
    if (activeProjector) {
      console.info(
        `[Workflow] Waiting for the search projector ${activeProjector.runId}`,
      );
      await sleep(LOCK_RETRY_DELAY);
      continue;
    }

    if (await searchRebuildInFlightStep()) {
      return {
        status: "deferred" as const,
        reason: "search_rebuild_in_flight",
      };
    }
    const initialized = await initializeSearchIndexMigrationStep(force);
    if (initialized.status === "ready") {
      return { status: "completed" as const, migration: initialized.result };
    }

    let state = initialized.state;
    while (true) {
      const batch = await runSearchIndexMigrationBatchStep(state);
      state = batch.state;
      if (batch.done) break;
    }
    const migration = await finalizeSearchIndexMigrationStep(state);
    return { status: "completed" as const, migration };
  }
}
