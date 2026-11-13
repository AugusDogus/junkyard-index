import type { ConnectorChunkStatus } from "./connector-chunk";
import { AutorecyclerCursor } from "./autorecycler-cursor";
import { AeroCursor } from "./aero-cursor";
import { BigtruckpageCursor } from "./bigtruckpage-cursor";
import { ArmyCursor } from "./army-cursor";
import { Alln1Cursor } from "./alln1-cursor";
import { AviationCursor } from "./aviation-cursor";
import { AwapCursor } from "./awap-cursor";
import { AplusCursor } from "./aplus-cursor";
import { BrandywineCursor } from "./brandywine-cursor";
import { CaltonCursor } from "./calton-cursor";
import { CALTON_CONTRACT } from "./calton-configuration";
import { UpullRPartsCursor } from "./upullrparts-cursor";
import {
  INGESTION_SOURCES,
  type IngestionSource,
} from "~/lib/ingestion-source";
import {
  durableSourceCursorEquals,
  GopullitCursorState,
  type DurableCursorFor,
  type DurableSourceCursor,
  UpullitDavieCursorState,
} from "./durable-cursor";

export {
  durableSourceCursorEquals,
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-cursor";
export type {
  DurableCursorFor,
  DurableSourceCursor,
  GopullitCursorState,
  PullapartDurableCursor,
  Row52DurableCursor,
  UpullitDavieCursorState,
} from "./durable-cursor";

export type DurableIngestionSource = IngestionSource;

export function durableSourceChunkProgressError(
  cursor: DurableSourceCursor,
  result: { status: ConnectorChunkStatus; cursor: DurableSourceCursor },
): string | null {
  return result.status === "paused" &&
    durableSourceCursorEquals(result.cursor, cursor)
    ? `Source ${cursor.source} returned its current cursor without completing`
    : null;
}

type DurableSourceDefinition<Source extends IngestionSource> = {
  initialCursor: DurableCursorFor<Source>;
  maxPagesPerChunk: number;
};

type DurableSourceRegistry = {
  [Source in IngestionSource]: DurableSourceDefinition<Source>;
};

export const DURABLE_INGESTION_SOURCES: readonly DurableIngestionSource[] =
  INGESTION_SOURCES;

const initialCalton = CaltonCursor.initial(CALTON_CONTRACT);
if (!initialCalton.ok) throw new Error(initialCalton.error.message);

export const DURABLE_SOURCE_DEFINITIONS: DurableSourceRegistry = {
  row52: {
    initialCursor: {
      source: "row52",
      afterLocationId: 0,
      locationIds: [],
      skip: 0,
    },
    maxPagesPerChunk: 1,
  },
  pyp: {
    initialCursor: {
      source: "pyp",
      storeCodes: null,
      storeIndex: 0,
      page: 0,
    },
    maxPagesPerChunk: 30,
  },
  autorecycler: {
    initialCursor: AutorecyclerCursor.initial,
    maxPagesPerChunk: 10,
  },
  pullapart: {
    initialCursor: { source: "pullapart", locationId: 0, makeId: 0 },
    maxPagesPerChunk: 10,
  },
  upullitne: {
    initialCursor: { source: "upullitne", storeIndex: 0 },
    maxPagesPerChunk: 5,
  },
  upullitdavie: {
    initialCursor: {
      source: "upullitdavie",
      ...UpullitDavieCursorState.initial,
    },
    maxPagesPerChunk: 24,
  },
  gopullit: {
    initialCursor: {
      source: "gopullit",
      ...GopullitCursorState.initial,
    },
    maxPagesPerChunk: 24,
  },
  pullnsave: {
    initialCursor: { source: "pullnsave", page: 1 },
    maxPagesPerChunk: 10,
  },
  tearapart: {
    initialCursor: { source: "tearapart", storeIndex: 0 },
    maxPagesPerChunk: 5,
  },
  wrenchapart: {
    initialCursor: { source: "wrenchapart", afterLocationId: 0 },
    maxPagesPerChunk: 1,
  },
  upullrparts: {
    initialCursor: UpullRPartsCursor.initial,
    maxPagesPerChunk: 1,
  },
  ipullupull: {
    initialCursor: { source: "ipullupull", catalog: 0 },
    maxPagesPerChunk: 1,
  },
  upullitwa: {
    initialCursor: { source: "upullitwa", phase: "start" },
    maxPagesPerChunk: 2,
  },
  partsgalore: {
    initialCursor: { source: "partsgalore", catalog: 0 },
    maxPagesPerChunk: 1,
  },
  aero: { initialCursor: AeroCursor.initial, maxPagesPerChunk: 1 },
  army: { initialCursor: ArmyCursor.initial, maxPagesPerChunk: 1 },
  alln1: { initialCursor: Alln1Cursor.initial, maxPagesPerChunk: 3 },
  aviation: { initialCursor: AviationCursor.initial, maxPagesPerChunk: 8 },
  awap: { initialCursor: AwapCursor.initial, maxPagesPerChunk: 8 },
  aplus: { initialCursor: AplusCursor.initial, maxPagesPerChunk: 8 },
  brandywine: {
    initialCursor: BrandywineCursor.initial(null),
    maxPagesPerChunk: 3,
  },
  calton: {
    initialCursor: initialCalton.value,
    maxPagesPerChunk: 8,
  },
  bigtruckpage: {
    initialCursor: BigtruckpageCursor.initial,
    maxPagesPerChunk: 2,
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
