import { createHook, sleep } from "workflow";
import {
  finalizeSearchIndexMigrationStep,
  initializeSearchIndexMigrationStep,
  runSearchIndexMigrationBatchStep,
} from "./vehicle-steps";

const MIGRATION_RUN_TOKEN = "search-index-schema-migration";
const ALGOLIA_WRITES_TOKEN = "algolia-writes";
const LOCK_RETRY_DELAY = "30s";

export async function searchIndexMigrationWorkflow() {
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
    using algoliaWrites = createHook({ token: ALGOLIA_WRITES_TOKEN });
    const activeWriter = await algoliaWrites.getConflict();
    if (activeWriter) {
      console.info(
        `[Workflow] Waiting for Algolia writer ${activeWriter.runId}`,
      );
      await sleep(LOCK_RETRY_DELAY);
      continue;
    }

    const initialized = await initializeSearchIndexMigrationStep();
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
