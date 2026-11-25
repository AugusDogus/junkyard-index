import { AlgoliaError } from "./algolia-error";
import { retainModelUrls } from "~/server/model-url-history";
import { backfillVinVehicles } from "./vin-backfill";
import { InventorySnapshot } from "~/server/inventory-snapshot";
import { asc, gt } from "drizzle-orm";
import { ALGOLIA_INDEX_NAME, getAlgoliaAdminClient } from "~/lib/algolia";
import { ALGOLIA_SEARCH_INDEX_NAMES } from "~/lib/constants";
import { db } from "~/lib/db";
import {
  CURRENT_SEARCH_SCHEMA_VERSION,
  getSearchSchemaVersion,
  withSearchSchemaVersion,
} from "~/lib/search-index-schema";
import { VinPattern } from "~/lib/vin-pattern";
import { vehicle, vehicleModelRedirect } from "~/schema";
import { SearchIndexSchemaMarker } from "./search-index-schema-marker";
import { projectSearchVehicles } from "./vehicle-search-projection";
import {
  buildVinFilterValidationRequests,
  SearchIndexMigrationValidationError,
} from "./search-index-validation";
import { configureAlgoliaIndex, syncToAlgolia } from "./sync-algolia";

// One workflow step per batch. The run also holds the VIN cache pass and
// each step adds three events, so batches must stay large enough to cover
// the whole inventory well inside the run's 25,000-event limit. Enrichment
// no longer calls vPIC here, so a batch is a few Turso reads and one Algolia
// save.
const DEFAULT_BATCH_SIZE = 1000;
const VALIDATION_SAMPLE_SIZE = 3;

export { SearchIndexMigrationValidationError } from "./search-index-validation";

export interface SearchIndexMigrationProgress {
  batchesProcessed: number;
  recordsProcessed: number;
}

export interface SearchIndexMigrationResult extends SearchIndexMigrationProgress {
  alreadyReady: boolean;
  schemaVersion: number;
  validatedVins: string[];
  redirects: number;
}

export interface SearchIndexMigrationState extends SearchIndexMigrationProgress {
  cursor: string | null;
  validationVins: string[];
}

export type InitializeSearchIndexMigrationResult =
  | { status: "ready"; result: SearchIndexMigrationResult }
  | { status: "pending"; state: SearchIndexMigrationState };

export interface SearchIndexMigrationBatchResult {
  done: boolean;
  state: SearchIndexMigrationState;
}

async function readVehicleBatch(cursor: string | null, batchSize: number) {
  if (cursor === null) {
    return db.select().from(vehicle).orderBy(asc(vehicle.vin)).limit(batchSize);
  }

  return db
    .select()
    .from(vehicle)
    .where(gt(vehicle.vin, cursor))
    .orderBy(asc(vehicle.vin))
    .limit(batchSize);
}

async function validateSearchFilters(vins: string[]): Promise<void> {
  for (const vin of vins) {
    const response = await getAlgoliaAdminClient().searchForHits<{
      objectID?: string;
    }>({
      requests: buildVinFilterValidationRequests(vin),
    });
    for (const [index, indexName] of ALGOLIA_SEARCH_INDEX_NAMES.entries()) {
      const matchingHit = response.results[index]?.hits[0];
      if (matchingHit?.objectID !== vin) {
        throw new SearchIndexMigrationValidationError(
          `Search filter validation failed for ${vin} on ${indexName}. The schema marker was not advanced. Re-run the search-index migration after confirming every replica contains the expected filter tokens and searchable VIN prefixes.`,
        );
      }
    }
  }
}

async function markSchemaReady(userData: unknown): Promise<void> {
  const updatedUserData = withSearchSchemaVersion(
    userData,
    CURRENT_SEARCH_SCHEMA_VERSION,
  );
  if (!updatedUserData.success) {
    throw new SearchIndexMigrationValidationError(
      "Algolia index userData has an incompatible shape. The schema marker was not advanced to avoid overwriting existing metadata.",
    );
  }

  const response = await getAlgoliaAdminClient().setSettings({
    indexName: ALGOLIA_INDEX_NAME,
    indexSettings: { userData: updatedUserData.data },
  });
  await getAlgoliaAdminClient().waitForTask({
    indexName: ALGOLIA_INDEX_NAME,
    taskID: response.taskID,
  });
}

export async function initializeSearchIndexMigration(
  force = false,
): Promise<InitializeSearchIndexMigrationResult> {
  // A missing index (a new environment) counts as schema version 0: the
  // settings plan creates it and the migration fills it.
  const currentVersion = await getAlgoliaAdminClient()
    .getSettings({ indexName: ALGOLIA_INDEX_NAME })
    .then(
      (settings) => getSearchSchemaVersion(settings.userData),
      (error: unknown) => {
        const failure = AlgoliaError.classify(
          { operation: "getSettings", indexName: ALGOLIA_INDEX_NAME },
          error,
        );
        if (failure._tag === "NotFound") return 0;
        throw error;
      },
    );
  if (!force && currentVersion >= CURRENT_SEARCH_SCHEMA_VERSION) {
    // Repairs a Turso marker missed when finalization stopped after Algolia.
    await SearchIndexSchemaMarker.record(
      db,
      ALGOLIA_INDEX_NAME,
      currentVersion,
    );
    return {
      status: "ready",
      result: {
        alreadyReady: true,
        batchesProcessed: 0,
        recordsProcessed: 0,
        schemaVersion: currentVersion,
        validatedVins: [],
        redirects: 0,
      },
    };
  }

  await retainModelUrls(db);
  await configureAlgoliaIndex();
  return {
    status: "pending",
    state: {
      cursor: null,
      batchesProcessed: 0,
      recordsProcessed: 0,
      validationVins: [],
    },
  };
}

export async function migrateSearchIndexBatch(
  state: SearchIndexMigrationState,
  batchSize = DEFAULT_BATCH_SIZE,
): Promise<SearchIndexMigrationBatchResult> {
  const normalizedBatchSize = Math.min(
    DEFAULT_BATCH_SIZE,
    Math.max(1, batchSize),
  );
  const rows = await readVehicleBatch(state.cursor, normalizedBatchSize);
  if (rows.length === 0) return { done: true, state };

  const projectedRows = await backfillVinVehicles(db, rows);
  const records = await projectSearchVehicles(db, projectedRows);
  await syncToAlgolia(records, []);

  const validationVins = [...state.validationVins];
  if (validationVins.length < VALIDATION_SAMPLE_SIZE) {
    for (const row of rows) {
      if (VinPattern.parse(row.vin).success) validationVins.push(row.vin);
      if (validationVins.length === VALIDATION_SAMPLE_SIZE) break;
    }
  }

  return {
    done: rows.length < normalizedBatchSize,
    state: {
      cursor: rows.at(-1)?.vin ?? state.cursor,
      batchesProcessed: state.batchesProcessed + 1,
      recordsProcessed: state.recordsProcessed + rows.length,
      validationVins,
    },
  };
}

export async function finalizeSearchIndexMigration(
  state: SearchIndexMigrationState,
): Promise<SearchIndexMigrationResult> {
  if (state.recordsProcessed > 0 && state.validationVins.length === 0) {
    throw new SearchIndexMigrationValidationError(
      "Search index migration found records but no valid 17-character VIN to validate. The schema marker was not advanced and VIN search remains inactive.",
    );
  }

  await validateSearchFilters(state.validationVins);
  const latestSettings = await getAlgoliaAdminClient().getSettings({
    indexName: ALGOLIA_INDEX_NAME,
  });
  await InventorySnapshot.project(db, new Date());
  const livePaths = new Set(await InventorySnapshot.modelUrls(db));
  const retainedUrls = await db.select().from(vehicleModelRedirect);
  const redirects = retainedUrls.filter(
    (row) => !livePaths.has(row.fromPath),
  ).length;
  // Turso first: every vehicle row now has its identities, so ingestion may
  // canonicalize even if the Algolia marker below fails and is retried.
  await SearchIndexSchemaMarker.record(
    db,
    ALGOLIA_INDEX_NAME,
    CURRENT_SEARCH_SCHEMA_VERSION,
  );
  await markSchemaReady(latestSettings.userData);

  return {
    alreadyReady: false,
    batchesProcessed: state.batchesProcessed,
    recordsProcessed: state.recordsProcessed,
    schemaVersion: CURRENT_SEARCH_SCHEMA_VERSION,
    validatedVins: state.validationVins,
    redirects,
  };
}
