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
import { vehicle } from "~/schema";
import { projectSearchVehicles } from "./vehicle-search-projection";
import {
  buildVinFilterValidationRequests,
  SearchIndexMigrationValidationError,
} from "./search-index-validation";
import { configureAlgoliaIndex, syncToAlgolia } from "./sync-algolia";

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

export async function initializeSearchIndexMigration(): Promise<InitializeSearchIndexMigrationResult> {
  const settings = await getAlgoliaAdminClient().getSettings({
    indexName: ALGOLIA_INDEX_NAME,
  });
  const currentVersion = getSearchSchemaVersion(settings.userData);
  if (currentVersion >= CURRENT_SEARCH_SCHEMA_VERSION) {
    return {
      status: "ready",
      result: {
        alreadyReady: true,
        batchesProcessed: 0,
        recordsProcessed: 0,
        schemaVersion: currentVersion,
        validatedVins: [],
      },
    };
  }

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
  const normalizedBatchSize = Math.max(1, batchSize);
  const rows = await readVehicleBatch(state.cursor, normalizedBatchSize);
  if (rows.length === 0) return { done: true, state };

  const records = await projectSearchVehicles(db, rows);
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
  await markSchemaReady(latestSettings.userData);

  return {
    alreadyReady: false,
    batchesProcessed: state.batchesProcessed,
    recordsProcessed: state.recordsProcessed,
    schemaVersion: CURRENT_SEARCH_SCHEMA_VERSION,
    validatedVins: state.validationVins,
  };
}
