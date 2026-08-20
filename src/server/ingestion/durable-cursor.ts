import { z } from "zod";
import type { IngestionSource } from "~/lib/ingestion-source";

const NonNegativeIntegerSchema = z.number().int().nonnegative().safe();
const PositiveIntegerSchema = z.number().int().positive().safe();

type SourceCursor<Source extends IngestionSource = IngestionSource> = {
  source: Source;
};

type DurableCursorDefinition<Cursor extends SourceCursor> = {
  parse: (value: string) => Cursor;
  serialize: (cursor: Cursor) => string;
};

function invalidCursor(source: IngestionSource, value: string): Error {
  return new Error(`Invalid ${source} ingestion cursor: ${value}`);
}

function parseWithSchema<Cursor extends SourceCursor>(
  source: Cursor["source"],
  schema: z.ZodType<Cursor>,
  value: unknown,
  serializedValue: string,
): Cursor {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw invalidCursor(source, serializedValue);
  return parsed.data;
}

function parseNonNegativeInteger(
  value: string,
  source: IngestionSource,
): number {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw invalidCursor(source, value);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw invalidCursor(source, value);
  return parsed;
}

function parseJsonPayload(value: string, source: IngestionSource): unknown {
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

function parsePair(
  value: string,
  source: IngestionSource,
): readonly [number, number] {
  const parts = value.split(":");
  if (parts.length !== 2) throw invalidCursor(source, value);
  const [first, second] = parts;
  if (first === undefined || second === undefined) {
    throw invalidCursor(source, value);
  }
  return [
    parseNonNegativeInteger(first, source),
    parseNonNegativeInteger(second, source),
  ];
}

function defineJsonCursor<
  Source extends IngestionSource,
  Cursor extends SourceCursor<Source>,
>(source: Source, schema: z.ZodType<Cursor>): DurableCursorDefinition<Cursor> {
  return {
    parse: (value) =>
      parseWithSchema(source, schema, parseJsonPayload(value, source), value),
    serialize: (cursor) => {
      const parsed = parseWithSchema(
        source,
        schema,
        cursor,
        JSON.stringify(cursor),
      );
      const payload = Object.fromEntries(
        Object.entries(parsed).filter(([key]) => key !== "source"),
      );
      return JSON.stringify(payload);
    },
  };
}

function defineScalarCursor<
  Source extends IngestionSource,
  Cursor extends SourceCursor<Source>,
>(
  source: Source,
  schema: z.ZodType<Cursor>,
  fromInteger: (value: number) => Cursor,
  toInteger: (cursor: Cursor) => number,
): DurableCursorDefinition<Cursor> {
  return {
    parse: (value) =>
      parseWithSchema(
        source,
        schema,
        fromInteger(parseNonNegativeInteger(value, source)),
        value,
      ),
    serialize: (cursor) =>
      String(
        toInteger(
          parseWithSchema(source, schema, cursor, JSON.stringify(cursor)),
        ),
      ),
  };
}

function definePairCursor<
  Source extends IngestionSource,
  Cursor extends SourceCursor<Source>,
>(
  source: Source,
  schema: z.ZodType<Cursor>,
  fromPair: (first: number, second: number) => Cursor,
  toPair: (cursor: Cursor) => readonly [number, number],
): DurableCursorDefinition<Cursor> {
  return {
    parse: (value) => {
      const [first, second] = parsePair(value, source);
      return parseWithSchema(source, schema, fromPair(first, second), value);
    },
    serialize: (cursor) => {
      const [first, second] = toPair(
        parseWithSchema(source, schema, cursor, JSON.stringify(cursor)),
      );
      return `${first}:${second}`;
    },
  };
}

const DURABLE_CURSOR_DEFINITIONS = {
  row52: defineJsonCursor(
    "row52",
    z.object({
      source: z.literal("row52"),
      afterLocationId: NonNegativeIntegerSchema,
      locationIds: z.array(NonNegativeIntegerSchema),
      skip: NonNegativeIntegerSchema,
    }),
  ),
  pyp: defineScalarCursor(
    "pyp",
    z.object({
      source: z.literal("pyp"),
      page: NonNegativeIntegerSchema,
    }),
    (page) => ({ source: "pyp", page }),
    (cursor) => cursor.page,
  ),
  autorecycler: defineScalarCursor(
    "autorecycler",
    z.object({
      source: z.literal("autorecycler"),
      from: NonNegativeIntegerSchema,
    }),
    (from) => ({ source: "autorecycler", from }),
    (cursor) => cursor.from,
  ),
  pullapart: definePairCursor(
    "pullapart",
    z.object({
      source: z.literal("pullapart"),
      locationId: NonNegativeIntegerSchema,
      makeId: NonNegativeIntegerSchema,
    }),
    (locationId, makeId) => ({ source: "pullapart", locationId, makeId }),
    (cursor) => [cursor.locationId, cursor.makeId],
  ),
  upullitne: defineScalarCursor(
    "upullitne",
    z.object({
      source: z.literal("upullitne"),
      storeIndex: NonNegativeIntegerSchema,
    }),
    (storeIndex) => ({ source: "upullitne", storeIndex }),
    (cursor) => cursor.storeIndex,
  ),
  upullitdavie: defineJsonCursor(
    "upullitdavie",
    z.object({
      source: z.literal("upullitdavie"),
      page: PositiveIntegerSchema,
      totalPages: PositiveIntegerSchema.nullable(),
      totalCount: NonNegativeIntegerSchema.nullable(),
      pageSize: PositiveIntegerSchema.nullable(),
      recordsProcessed: NonNegativeIntegerSchema,
      recordsRejected: NonNegativeIntegerSchema,
    }),
  ),
  gopullit: defineJsonCursor(
    "gopullit",
    z.object({
      source: z.literal("gopullit"),
      page: PositiveIntegerSchema,
      recordsProcessed: NonNegativeIntegerSchema,
      recordsSkipped: NonNegativeIntegerSchema,
    }),
  ),
} satisfies Record<IngestionSource, unknown>;

type DurableCursorBySource = {
  [Source in IngestionSource]: ReturnType<
    (typeof DURABLE_CURSOR_DEFINITIONS)[Source]["parse"]
  >;
};

type DurableCursorRegistry = {
  [Source in IngestionSource]: DurableCursorDefinition<
    DurableCursorFor<Source>
  >;
};

const durableCursorRegistry: DurableCursorRegistry = DURABLE_CURSOR_DEFINITIONS;

export type DurableSourceCursor = DurableCursorBySource[IngestionSource];
export type DurableCursorFor<Source extends IngestionSource> =
  DurableCursorBySource[Source] & { source: Source };
export type Row52DurableCursor = DurableCursorFor<"row52">;
export type PullapartDurableCursor = DurableCursorFor<"pullapart">;
export type UpullitDavieCursorState = Omit<
  DurableCursorFor<"upullitdavie">,
  "source"
>;
export type GopullitCursorState = Omit<DurableCursorFor<"gopullit">, "source">;

export const UpullitDavieCursorState = {
  initial: {
    page: 1,
    totalPages: null,
    totalCount: null,
    pageSize: null,
    recordsProcessed: 0,
    recordsRejected: 0,
  },
} as const satisfies { initial: UpullitDavieCursorState };

export const GopullitCursorState = {
  initial: {
    page: 1,
    recordsProcessed: 0,
    recordsSkipped: 0,
  },
} as const satisfies { initial: GopullitCursorState };

function getDurableCursorDefinition<Source extends IngestionSource>(
  source: Source,
): DurableCursorDefinition<DurableCursorFor<Source>> {
  return durableCursorRegistry[source];
}

export function parseDurableSourceCursor<Source extends IngestionSource>(
  source: Source,
  value: string,
): DurableCursorFor<Source> {
  return getDurableCursorDefinition(source).parse(value);
}

export function serializeDurableSourceCursor<Source extends IngestionSource>(
  cursor: DurableCursorFor<Source>,
): string {
  return getDurableCursorDefinition(cursor.source).serialize(cursor);
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
