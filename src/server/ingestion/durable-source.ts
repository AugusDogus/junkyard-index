import { z } from "zod";
import {
  INGESTION_SOURCES,
  type IngestionSource,
} from "~/lib/ingestion-source";

const NonNegativeIntegerSchema = z.number().int().nonnegative().safe();
const Row52CursorPayloadSchema = z.object({
  afterLocationId: NonNegativeIntegerSchema,
  locationIds: z.array(NonNegativeIntegerSchema),
  skip: NonNegativeIntegerSchema,
});
const UpullitDavieCursorPayloadSchema = z.object({
  page: z.number().int().positive().safe(),
  totalPages: z.number().int().positive().safe().nullable(),
  totalCount: NonNegativeIntegerSchema.nullable(),
  recordsProcessed: NonNegativeIntegerSchema,
});

export type DurableSourceCursor =
  | {
      source: "row52";
      afterLocationId: number;
      locationIds: number[];
      skip: number;
    }
  | { source: "pyp"; page: number }
  | { source: "autorecycler"; from: number }
  | { source: "pullapart"; locationId: number; makeId: number }
  | { source: "upullitne"; storeIndex: number }
  | {
      source: "upullitdavie";
      page: number;
      totalPages: number | null;
      totalCount: number | null;
      recordsProcessed: number;
    }
  | { source: "gopullit"; page: number };

export type Row52DurableCursor = Extract<
  DurableSourceCursor,
  { source: "row52" }
>;
export type PullapartDurableCursor = Extract<
  DurableSourceCursor,
  { source: "pullapart" }
>;

export type DurableCursorFor<Source extends IngestionSource> = Extract<
  DurableSourceCursor,
  { source: Source }
>;
export type DurableIngestionSource = IngestionSource;

interface DurableSourceDefinition<Source extends IngestionSource> {
  initialCursor: DurableCursorFor<Source>;
  maxPagesPerChunk: number;
  parseCursor: (value: string) => DurableCursorFor<Source>;
}

type DurableSourceRegistry = {
  [Source in IngestionSource]: DurableSourceDefinition<Source>;
};

export const DURABLE_INGESTION_SOURCES: readonly DurableIngestionSource[] =
  INGESTION_SOURCES;

function parseNonNegativeInteger(
  value: string,
  source: DurableIngestionSource,
): number {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`Invalid ${source} ingestion cursor: ${value}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Invalid ${source} ingestion cursor: ${value}`);
  }
  return parsed;
}

function parsePair(
  value: string,
  source: "pullapart",
): readonly [number, number] {
  const parts = value.split(":");
  if (parts.length !== 2) {
    throw new Error(`Invalid ${source} ingestion cursor: ${value}`);
  }
  const [first, second] = parts;
  if (first === undefined || second === undefined) {
    throw new Error(`Invalid ${source} ingestion cursor: ${value}`);
  }
  return [
    parseNonNegativeInteger(first, source),
    parseNonNegativeInteger(second, source),
  ];
}

export const DURABLE_SOURCE_DEFINITIONS: DurableSourceRegistry = {
  row52: {
    initialCursor: {
      source: "row52",
      afterLocationId: 0,
      locationIds: [],
      skip: 0,
    },
    maxPagesPerChunk: 10,
    parseCursor: (value) => {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(value);
      } catch {
        throw new Error(`Invalid row52 ingestion cursor: ${value}`);
      }
      const parsed = Row52CursorPayloadSchema.safeParse(parsedJson);
      if (!parsed.success) {
        throw new Error(`Invalid row52 ingestion cursor: ${value}`);
      }
      return { source: "row52", ...parsed.data };
    },
  },
  pyp: {
    initialCursor: { source: "pyp", page: 1 },
    maxPagesPerChunk: 10,
    parseCursor: (value) => ({
      source: "pyp",
      page: parseNonNegativeInteger(value, "pyp"),
    }),
  },
  autorecycler: {
    initialCursor: { source: "autorecycler", from: 0 },
    maxPagesPerChunk: 10,
    parseCursor: (value) => ({
      source: "autorecycler",
      from: parseNonNegativeInteger(value, "autorecycler"),
    }),
  },
  pullapart: {
    initialCursor: { source: "pullapart", locationId: 0, makeId: 0 },
    maxPagesPerChunk: 1,
    parseCursor: (value) => {
      const [locationId, makeId] = parsePair(value, "pullapart");
      return { source: "pullapart", locationId, makeId };
    },
  },
  upullitne: {
    initialCursor: { source: "upullitne", storeIndex: 0 },
    maxPagesPerChunk: 5,
    parseCursor: (value) => ({
      source: "upullitne",
      storeIndex: parseNonNegativeInteger(value, "upullitne"),
    }),
  },
  upullitdavie: {
    initialCursor: {
      source: "upullitdavie",
      page: 1,
      totalPages: null,
      totalCount: null,
      recordsProcessed: 0,
    },
    maxPagesPerChunk: 24,
    parseCursor: (value) => {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(value);
      } catch {
        throw new Error(`Invalid upullitdavie ingestion cursor: ${value}`);
      }
      const parsed = UpullitDavieCursorPayloadSchema.safeParse(parsedJson);
      if (!parsed.success) {
        throw new Error(`Invalid upullitdavie ingestion cursor: ${value}`);
      }
      return { source: "upullitdavie", ...parsed.data };
    },
  },
  gopullit: {
    initialCursor: { source: "gopullit", page: 1 },
    maxPagesPerChunk: 24,
    parseCursor: (value) => ({
      source: "gopullit",
      page: parseNonNegativeInteger(value, "gopullit"),
    }),
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

export function parseDurableSourceCursor<Source extends DurableIngestionSource>(
  source: Source,
  value: string,
): DurableCursorFor<Source> {
  return getDurableSourceDefinition(source).parseCursor(value);
}

export function serializeDurableSourceCursor(
  cursor: DurableSourceCursor,
): string {
  switch (cursor.source) {
    case "row52":
      return JSON.stringify({
        afterLocationId: cursor.afterLocationId,
        locationIds: cursor.locationIds,
        skip: cursor.skip,
      });
    case "pyp":
      return String(cursor.page);
    case "autorecycler":
      return String(cursor.from);
    case "pullapart":
      return `${cursor.locationId}:${cursor.makeId}`;
    case "upullitne":
      return String(cursor.storeIndex);
    case "upullitdavie":
      return JSON.stringify({
        page: cursor.page,
        totalPages: cursor.totalPages,
        totalCount: cursor.totalCount,
        recordsProcessed: cursor.recordsProcessed,
      });
    case "gopullit":
      return String(cursor.page);
  }
}

export function durableSourceCursorEquals(
  left: DurableSourceCursor,
  right: DurableSourceCursor,
): boolean {
  if (left.source !== right.source) return false;
  switch (left.source) {
    case "row52":
      return (
        right.source === "row52" &&
        left.afterLocationId === right.afterLocationId &&
        left.skip === right.skip &&
        left.locationIds.length === right.locationIds.length &&
        left.locationIds.every(
          (locationId, index) => locationId === right.locationIds[index],
        )
      );
    case "pyp":
      return right.source === "pyp" && left.page === right.page;
    case "autorecycler":
      return right.source === "autorecycler" && left.from === right.from;
    case "pullapart":
      return (
        right.source === "pullapart" &&
        left.locationId === right.locationId &&
        left.makeId === right.makeId
      );
    case "upullitne":
      return (
        right.source === "upullitne" && left.storeIndex === right.storeIndex
      );
    case "upullitdavie":
      return (
        right.source === "upullitdavie" &&
        left.page === right.page &&
        left.totalPages === right.totalPages &&
        left.totalCount === right.totalCount &&
        left.recordsProcessed === right.recordsProcessed
      );
    case "gopullit":
      return right.source === "gopullit" && left.page === right.page;
  }
}
