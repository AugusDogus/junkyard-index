import type { Effect } from "effect";
import type { AlgoliaError } from "./algolia-error";
import type { AlgoliaVehicleRecord } from "./types";

/** What an index's settings say about it. Reading them sends no search. */
export interface SearchIndexMetadata {
  /** The generation marker stamped by the rebuild that built the index. */
  generation: string | null;
  /** The record schema version the index was built for (0 when unknown). */
  schemaVersion: number;
}

/**
 * The search backend as the search projector uses it. Every failure is an
 * `AlgoliaError` value, so the projector's circuit decides by tag; tests pass
 * a fake, so no test sends a request.
 */
export interface SearchIndexWriter {
  /** Upserts records. Resolves the last task to wait for, if any. */
  saveObjects(
    indexName: string,
    records: readonly AlgoliaVehicleRecord[],
  ): Effect.Effect<number | null, AlgoliaError>;
  /** Deletes records by objectID (VIN). Resolves the last task, if any. */
  deleteObjects(
    indexName: string,
    objectIDs: readonly string[],
  ): Effect.Effect<number | null, AlgoliaError>;
  waitForTask(
    indexName: string,
    taskId: number,
  ): Effect.Effect<void, AlgoliaError>;
  /** Reads the index settings: the projector's cheap half-open probe. */
  metadata(indexName: string): Effect.Effect<SearchIndexMetadata, AlgoliaError>;
}
