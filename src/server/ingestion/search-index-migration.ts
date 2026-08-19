import { asc, gt } from "drizzle-orm";
import { algoliaClient, ALGOLIA_INDEX_NAME } from "~/lib/algolia";
import { db } from "~/lib/db";
import {
  getSearchSchemaVersion,
  VIN_PATTERN_SEARCH_SCHEMA_VERSION,
  withSearchSchemaVersion,
} from "~/lib/search-index-schema";
import { VinPattern } from "~/lib/vin-pattern";
import { vehicle } from "~/schema";
import { mapDbVehicleToCanonical } from "./algolia-projector-helpers";
import { configureAlgoliaIndex, syncToAlgolia } from "./sync-algolia";
import { toAlgoliaRecord } from "./types";

const DEFAULT_BATCH_SIZE = 1000;
const VALIDATION_SAMPLE_SIZE = 3;

export interface SearchIndexMigrationProgress {
  batchesProcessed: number;
  recordsProcessed: number;
}

export interface SearchIndexMigrationResult extends SearchIndexMigrationProgress {
  alreadyReady: boolean;
  schemaVersion: number;
  validatedVins: string[];
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

async function validateVinFilters(vins: string[]): Promise<void> {
  for (const vin of vins) {
    const parsedPattern = VinPattern.parse(vin);
    if (!parsedPattern.success) {
      throw new Error(
        `Search index migration selected an invalid validation VIN: ${vin}`,
      );
    }

    const filters = VinPattern.toAlgoliaFilter(parsedPattern.data);
    if (!filters) {
      throw new Error(
        `Search index migration could not build a validation filter for VIN: ${vin}`,
      );
    }

    const response = await algoliaClient.searchForHits<{ objectID?: string }>({
      requests: [
        {
          indexName: ALGOLIA_INDEX_NAME,
          query: "",
          filters,
          hitsPerPage: 1,
          attributesToRetrieve: ["objectID"],
        },
      ],
    });
    const matchingHit = response.results[0]?.hits[0];
    if (matchingHit?.objectID !== vin) {
      throw new Error(
        `VIN filter validation failed for ${vin}. The schema marker was not advanced and the VIN UI remains disabled.`,
      );
    }
  }
}

async function markSchemaReady(userData: unknown): Promise<void> {
  const updatedUserData = withSearchSchemaVersion(
    userData,
    VIN_PATTERN_SEARCH_SCHEMA_VERSION,
  );
  if (!updatedUserData.success) {
    throw new Error(
      "Algolia index userData has an incompatible shape. The schema marker was not advanced to avoid overwriting existing metadata.",
    );
  }

  const response = await algoliaClient.setSettings({
    indexName: ALGOLIA_INDEX_NAME,
    indexSettings: { userData: updatedUserData.data },
  });
  await algoliaClient.waitForTask({
    indexName: ALGOLIA_INDEX_NAME,
    taskID: response.taskID,
  });
}

export async function migrateSearchIndexToVinPatternSchema(options?: {
  batchSize?: number;
  onProgress?: (progress: SearchIndexMigrationProgress) => void;
}): Promise<SearchIndexMigrationResult> {
  const settings = await algoliaClient.getSettings({
    indexName: ALGOLIA_INDEX_NAME,
  });
  const currentVersion = getSearchSchemaVersion(settings.userData);
  if (currentVersion >= VIN_PATTERN_SEARCH_SCHEMA_VERSION) {
    return {
      alreadyReady: true,
      batchesProcessed: 0,
      recordsProcessed: 0,
      schemaVersion: currentVersion,
      validatedVins: [],
    };
  }

  await configureAlgoliaIndex();

  const batchSize = Math.max(1, options?.batchSize ?? DEFAULT_BATCH_SIZE);
  const validationVins: string[] = [];
  let cursor: string | null = null;
  let batchesProcessed = 0;
  let recordsProcessed = 0;

  while (true) {
    const rows = await readVehicleBatch(cursor, batchSize);
    if (rows.length === 0) break;

    const records = rows.map((row) =>
      toAlgoliaRecord(
        mapDbVehicleToCanonical(row),
        row.firstSeenAt,
        row.missingSinceAt,
        row.missingRunCount ?? 0,
      ),
    );
    await syncToAlgolia(records, []);

    if (validationVins.length < VALIDATION_SAMPLE_SIZE) {
      for (const row of rows) {
        if (VinPattern.parse(row.vin).success) {
          validationVins.push(row.vin);
        }
        if (validationVins.length === VALIDATION_SAMPLE_SIZE) break;
      }
    }

    cursor = rows.at(-1)?.vin ?? cursor;
    batchesProcessed += 1;
    recordsProcessed += rows.length;
    options?.onProgress?.({ batchesProcessed, recordsProcessed });
  }

  if (recordsProcessed > 0 && validationVins.length === 0) {
    throw new Error(
      "Search index migration found records but no valid 17-character VIN to validate. The schema marker was not advanced and the VIN UI remains disabled.",
    );
  }

  await validateVinFilters(validationVins);
  const latestSettings = await algoliaClient.getSettings({
    indexName: ALGOLIA_INDEX_NAME,
  });
  await markSchemaReady(latestSettings.userData);

  return {
    alreadyReady: false,
    batchesProcessed,
    recordsProcessed,
    schemaVersion: VIN_PATTERN_SEARCH_SCHEMA_VERSION,
    validatedVins: validationVins,
  };
}
