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

/** One index as `listIndices` reports it. */
export interface SearchIndexListing {
  name: string;
  /** Records in the index; virtual replicas share their primary's. */
  entries: number;
  /** Set on a replica: the index it replicates. */
  primary: string | null;
  replicas: string[];
  virtual: boolean;
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
  /** Every index in the app, all pages. An admin call, not a search. */
  listIndices(): Effect.Effect<SearchIndexListing[], AlgoliaError>;
  /**
   * Creates `to` with `from`'s settings, synonyms and rules but no records,
   * and stamps it with `generation`. Waits until Algolia applied each step.
   * Resolves `missing_source`, creating nothing, when `from` does not exist
   * (Algolia would otherwise copy it as an empty default-settings index).
   */
  prepareIndex(params: {
    from: string;
    to: string;
    generation: string;
  }): Effect.Effect<"copied" | "missing_source", AlgoliaError>;
  /** Moves `from` over `to`. Resolves the move task to wait for on `from`. */
  moveIndex(from: string, to: string): Effect.Effect<number, AlgoliaError>;
  /** Deletes an index and waits; an index already gone counts as deleted. */
  deleteIndex(indexName: string): Effect.Effect<void, AlgoliaError>;
}
