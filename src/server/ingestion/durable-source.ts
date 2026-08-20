import {
  INGESTION_SOURCES,
  type IngestionSource,
} from "~/lib/ingestion-source";
import type { DurableCursorFor, DurableSourceCursor } from "./durable-cursor";

export {
  durableSourceCursorEquals,
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-cursor";
export type {
  DurableCursorFor,
  DurableSourceCursor,
  PullapartDurableCursor,
  Row52DurableCursor,
} from "./durable-cursor";

export type DurableIngestionSource = IngestionSource;

type DurableSourceDefinition<Source extends IngestionSource> = {
  initialCursor: DurableCursorFor<Source>;
  maxPagesPerChunk: number;
};

type DurableSourceRegistry = {
  [Source in IngestionSource]: DurableSourceDefinition<Source>;
};

export const DURABLE_INGESTION_SOURCES: readonly DurableIngestionSource[] =
  INGESTION_SOURCES;

export const DURABLE_SOURCE_DEFINITIONS: DurableSourceRegistry = {
  row52: {
    initialCursor: {
      source: "row52",
      afterLocationId: 0,
      locationIds: [],
      skip: 0,
    },
    maxPagesPerChunk: 10,
  },
  pyp: {
    initialCursor: { source: "pyp", page: 1 },
    maxPagesPerChunk: 10,
  },
  autorecycler: {
    initialCursor: { source: "autorecycler", from: 0 },
    maxPagesPerChunk: 10,
  },
  pullapart: {
    initialCursor: { source: "pullapart", locationId: 0, makeId: 0 },
    maxPagesPerChunk: 1,
  },
  upullitne: {
    initialCursor: { source: "upullitne", storeIndex: 0 },
    maxPagesPerChunk: 5,
  },
  upullitdavie: {
    initialCursor: {
      source: "upullitdavie",
      page: 1,
      totalPages: null,
      totalCount: null,
      pageSize: null,
      recordsProcessed: 0,
      recordsRejected: 0,
    },
    maxPagesPerChunk: 24,
  },
  gopullit: {
    initialCursor: {
      source: "gopullit",
      page: 1,
      recordsProcessed: 0,
      recordsSkipped: 0,
    },
    maxPagesPerChunk: 24,
  },
};

export function getDurableSourceDefinition<
  Source extends DurableIngestionSource,
>(source: Source): DurableSourceDefinition<Source> {
  return DURABLE_SOURCE_DEFINITIONS[source];
}

export const DURABLE_INITIAL_SOURCE_CURSORS: readonly DurableSourceCursor[] =
  INGESTION_SOURCES.map(
    (source) => getDurableSourceDefinition(source).initialCursor,
  );
