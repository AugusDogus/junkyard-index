import { z } from "zod";
import {
  INGESTION_SOURCES,
  type IngestionSource,
} from "~/lib/ingestion-source";

const NonNegativeIntegerSchema = z.number().int().nonnegative().safe();
const PositiveIntegerSchema = z.number().int().positive().safe();

const Row52CursorSchema = z.object({
  source: z.literal("row52"),
  afterLocationId: NonNegativeIntegerSchema,
  locationIds: z.array(NonNegativeIntegerSchema),
  skip: NonNegativeIntegerSchema,
});
const PypCursorSchema = z.object({
  source: z.literal("pyp"),
  page: NonNegativeIntegerSchema,
});
const AutorecyclerCursorSchema = z.object({
  source: z.literal("autorecycler"),
  from: NonNegativeIntegerSchema,
});
const PullapartCursorSchema = z.object({
  source: z.literal("pullapart"),
  locationId: NonNegativeIntegerSchema,
  makeId: NonNegativeIntegerSchema,
});
const UpullitneCursorSchema = z.object({
  source: z.literal("upullitne"),
  storeIndex: NonNegativeIntegerSchema,
});
const UpullitDavieCursorSchema = z.object({
  source: z.literal("upullitdavie"),
  page: PositiveIntegerSchema,
  totalPages: PositiveIntegerSchema.nullable(),
  totalCount: NonNegativeIntegerSchema.nullable(),
  pageSize: PositiveIntegerSchema.nullable(),
  recordsProcessed: NonNegativeIntegerSchema,
  recordsRejected: NonNegativeIntegerSchema,
});
const GopullitCursorSchema = z.object({
  source: z.literal("gopullit"),
  page: PositiveIntegerSchema,
  recordsProcessed: NonNegativeIntegerSchema,
  recordsSkipped: NonNegativeIntegerSchema,
});

const DURABLE_CURSOR_SCHEMAS = {
  row52: Row52CursorSchema,
  pyp: PypCursorSchema,
  autorecycler: AutorecyclerCursorSchema,
  pullapart: PullapartCursorSchema,
  upullitne: UpullitneCursorSchema,
  upullitdavie: UpullitDavieCursorSchema,
  gopullit: GopullitCursorSchema,
} as const;

type DurableCursorBySource = {
  [Source in IngestionSource]: z.infer<(typeof DURABLE_CURSOR_SCHEMAS)[Source]>;
};

export type DurableSourceCursor = DurableCursorBySource[IngestionSource];
export type DurableCursorFor<Source extends IngestionSource> = Extract<
  DurableSourceCursor,
  { source: Source }
>;
export type DurableIngestionSource = IngestionSource;
export type Row52DurableCursor = DurableCursorFor<"row52">;
export type PullapartDurableCursor = DurableCursorFor<"pullapart">;

interface DurableCursorCodec<Source extends IngestionSource> {
  schema: (typeof DURABLE_CURSOR_SCHEMAS)[Source];
  parse: (value: string) => DurableCursorFor<Source>;
  serialize: (cursor: DurableSourceCursor) => string;
}

interface DurableSourceDefinition<Source extends IngestionSource> {
  initialCursor: DurableCursorFor<Source>;
  maxPagesPerChunk: number;
  cursorCodec: DurableCursorCodec<Source>;
}

type DurableSourceRegistry = {
  [Source in IngestionSource]: DurableSourceDefinition<Source>;
};

export const DURABLE_INGESTION_SOURCES: readonly DurableIngestionSource[] =
  INGESTION_SOURCES;

function invalidCursor(source: DurableIngestionSource, value: string): Error {
  return new Error(`Invalid ${source} ingestion cursor: ${value}`);
}

function parseWithSchema<Schema extends z.ZodTypeAny>(
  source: DurableIngestionSource,
  schema: Schema,
  value: unknown,
  serializedValue: string,
): z.infer<Schema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw invalidCursor(source, serializedValue);
  return parsed.data;
}

function parseNonNegativeInteger(
  value: string,
  source: DurableIngestionSource,
): number {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw invalidCursor(source, value);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw invalidCursor(source, value);
  return parsed;
}

function parseJsonPayload(
  value: string,
  source: DurableIngestionSource,
): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw invalidCursor(source, value);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return parsed;
  }
  return { ...parsed, source };
}

function parsePair(value: string): readonly [number, number] {
  const parts = value.split(":");
  if (parts.length !== 2) throw invalidCursor("pullapart", value);
  const [first, second] = parts;
  if (first === undefined || second === undefined) {
    throw invalidCursor("pullapart", value);
  }
  return [
    parseNonNegativeInteger(first, "pullapart"),
    parseNonNegativeInteger(second, "pullapart"),
  ];
}

const Row52CursorCodec: DurableCursorCodec<"row52"> = {
  schema: Row52CursorSchema,
  parse: (value) =>
    parseWithSchema(
      "row52",
      Row52CursorSchema,
      parseJsonPayload(value, "row52"),
      value,
    ),
  serialize: (cursor) => {
    const parsed = parseWithSchema(
      "row52",
      Row52CursorSchema,
      cursor,
      JSON.stringify(cursor),
    );
    return JSON.stringify({
      afterLocationId: parsed.afterLocationId,
      locationIds: parsed.locationIds,
      skip: parsed.skip,
    });
  },
};

const PypCursorCodec: DurableCursorCodec<"pyp"> = {
  schema: PypCursorSchema,
  parse: (value) =>
    parseWithSchema(
      "pyp",
      PypCursorSchema,
      { source: "pyp", page: parseNonNegativeInteger(value, "pyp") },
      value,
    ),
  serialize: (cursor) =>
    String(
      parseWithSchema("pyp", PypCursorSchema, cursor, JSON.stringify(cursor))
        .page,
    ),
};

const AutorecyclerCursorCodec: DurableCursorCodec<"autorecycler"> = {
  schema: AutorecyclerCursorSchema,
  parse: (value) =>
    parseWithSchema(
      "autorecycler",
      AutorecyclerCursorSchema,
      {
        source: "autorecycler",
        from: parseNonNegativeInteger(value, "autorecycler"),
      },
      value,
    ),
  serialize: (cursor) =>
    String(
      parseWithSchema(
        "autorecycler",
        AutorecyclerCursorSchema,
        cursor,
        JSON.stringify(cursor),
      ).from,
    ),
};

const PullapartCursorCodec: DurableCursorCodec<"pullapart"> = {
  schema: PullapartCursorSchema,
  parse: (value) => {
    const [locationId, makeId] = parsePair(value);
    return parseWithSchema(
      "pullapart",
      PullapartCursorSchema,
      { source: "pullapart", locationId, makeId },
      value,
    );
  },
  serialize: (cursor) => {
    const parsed = parseWithSchema(
      "pullapart",
      PullapartCursorSchema,
      cursor,
      JSON.stringify(cursor),
    );
    return `${parsed.locationId}:${parsed.makeId}`;
  },
};

const UpullitneCursorCodec: DurableCursorCodec<"upullitne"> = {
  schema: UpullitneCursorSchema,
  parse: (value) =>
    parseWithSchema(
      "upullitne",
      UpullitneCursorSchema,
      {
        source: "upullitne",
        storeIndex: parseNonNegativeInteger(value, "upullitne"),
      },
      value,
    ),
  serialize: (cursor) =>
    String(
      parseWithSchema(
        "upullitne",
        UpullitneCursorSchema,
        cursor,
        JSON.stringify(cursor),
      ).storeIndex,
    ),
};

const UpullitDavieCursorCodec: DurableCursorCodec<"upullitdavie"> = {
  schema: UpullitDavieCursorSchema,
  parse: (value) =>
    parseWithSchema(
      "upullitdavie",
      UpullitDavieCursorSchema,
      parseJsonPayload(value, "upullitdavie"),
      value,
    ),
  serialize: (cursor) => {
    const parsed = parseWithSchema(
      "upullitdavie",
      UpullitDavieCursorSchema,
      cursor,
      JSON.stringify(cursor),
    );
    return JSON.stringify({
      page: parsed.page,
      totalPages: parsed.totalPages,
      totalCount: parsed.totalCount,
      pageSize: parsed.pageSize,
      recordsProcessed: parsed.recordsProcessed,
      recordsRejected: parsed.recordsRejected,
    });
  },
};

const GopullitCursorCodec: DurableCursorCodec<"gopullit"> = {
  schema: GopullitCursorSchema,
  parse: (value) =>
    parseWithSchema(
      "gopullit",
      GopullitCursorSchema,
      parseJsonPayload(value, "gopullit"),
      value,
    ),
  serialize: (cursor) => {
    const parsed = parseWithSchema(
      "gopullit",
      GopullitCursorSchema,
      cursor,
      JSON.stringify(cursor),
    );
    return JSON.stringify({
      page: parsed.page,
      recordsProcessed: parsed.recordsProcessed,
      recordsSkipped: parsed.recordsSkipped,
    });
  },
};

export const DURABLE_SOURCE_DEFINITIONS: DurableSourceRegistry = {
  row52: {
    initialCursor: {
      source: "row52",
      afterLocationId: 0,
      locationIds: [],
      skip: 0,
    },
    maxPagesPerChunk: 10,
    cursorCodec: Row52CursorCodec,
  },
  pyp: {
    initialCursor: { source: "pyp", page: 1 },
    maxPagesPerChunk: 10,
    cursorCodec: PypCursorCodec,
  },
  autorecycler: {
    initialCursor: { source: "autorecycler", from: 0 },
    maxPagesPerChunk: 10,
    cursorCodec: AutorecyclerCursorCodec,
  },
  pullapart: {
    initialCursor: { source: "pullapart", locationId: 0, makeId: 0 },
    maxPagesPerChunk: 1,
    cursorCodec: PullapartCursorCodec,
  },
  upullitne: {
    initialCursor: { source: "upullitne", storeIndex: 0 },
    maxPagesPerChunk: 5,
    cursorCodec: UpullitneCursorCodec,
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
    cursorCodec: UpullitDavieCursorCodec,
  },
  gopullit: {
    initialCursor: {
      source: "gopullit",
      page: 1,
      recordsProcessed: 0,
      recordsSkipped: 0,
    },
    maxPagesPerChunk: 24,
    cursorCodec: GopullitCursorCodec,
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
  return getDurableSourceDefinition(source).cursorCodec.parse(value);
}

export function serializeDurableSourceCursor(
  cursor: DurableSourceCursor,
): string {
  return DURABLE_SOURCE_DEFINITIONS[cursor.source].cursorCodec.serialize(
    cursor,
  );
}

export function durableSourceCursorEquals(
  left: DurableSourceCursor,
  right: DurableSourceCursor,
): boolean {
  return (
    left.source === right.source &&
    serializeDurableSourceCursor(left) === serializeDurableSourceCursor(right)
  );
}
