import { createHook, sleep } from "workflow";
import { IngestionTokens } from "./ingestion-tokens";
import { searchRebuildInFlightStep } from "./search-projector-steps";
import { runVinCachePass } from "~/server/ingestion/vin-cache-pass";
import {
  expireInventoryAfterMigrationStep,
  finalizeSearchIndexMigrationStep,
  initializeSearchIndexMigrationStep,
  runSearchIndexMigrationBatchStep,
  searchPublicationModeStep,
  warmVinCacheBatchStep,
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

  // No shared writer or ingestion commit is held during network enrichment.
  // A service failure opens the circuit for this pass, then publishes fallbacks.
  await runVinCachePass(warmVinCacheBatchStep);

  // Frozen search makes no Algolia request, even a settings read. Warmed
  // identities still reach Turso through reconciliation, and the first inline
  // run after the freeze rebuilds the index from Turso. Decoupled publication
  // ignores the skip flag, as runs do, and the writer and rebuild guards below
  // keep the projector the only other writer. An unreadable publication mode
  // writes nothing; the next daily run tries again.
  const publication = await searchPublicationModeStep();
  if (publication === "skipped") {
    return {
      status: "skipped" as const,
      reason: "search_publication_skipped" as const,
    };
  }
  if (publication === "mode_unavailable") {
    return {
      status: "skipped" as const,
      reason: "publication_mode_unavailable" as const,
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
    // Newly cached decodes reach each vehicle through ingestion's
    // canonicalization on its source's next run, so they never force a full
    // rewrite: ~494K records a day would exceed Algolia's indexing limits.
    const initialized = await initializeSearchIndexMigrationStep(force);
    if (initialized.status === "ready") {
      return { status: "completed" as const, migration: initialized.result };
    }

    let state = initialized.state;
    try {
      while (true) {
        const batch = await runSearchIndexMigrationBatchStep(state);
        state = batch.state;
        if (batch.done) break;
      }
      const migration = await finalizeSearchIndexMigrationStep(state);
      return { status: "completed" as const, migration };
    } catch (error) {
      // Batches that ran rewrote vehicles; pages must not keep the old
      // identities until their daily expiry.
      if (state.batchesProcessed > 0) await expireInventoryAfterMigrationStep();
      throw error;
    }
  }
}
