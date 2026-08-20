import { z } from "zod";
import type { IngestionSource } from "~/lib/ingestion-source";

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
export type Row52DurableCursor = DurableCursorFor<"row52">;
export type PullapartDurableCursor = DurableCursorFor<"pullapart">;

type DurableCursorCodec<Source extends IngestionSource> = {
  parse: (value: string) => DurableCursorFor<Source>;
  serialize: (cursor: DurableCursorFor<Source>) => string;
};

type DurableCursorCodecRegistry = {
  [Source in IngestionSource]: DurableCursorCodec<Source>;
};

function invalidCursor(source: IngestionSource, value: string): Error {
  return new Error(`Invalid ${source} ingestion cursor: ${value}`);
}

function parseWithSchema<Schema extends z.ZodTypeAny>(
  source: IngestionSource,
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

function createJsonCursorCodec<Source extends IngestionSource>(
  source: Source,
  schema: z.ZodType<DurableCursorFor<Source>>,
): DurableCursorCodec<Source> {
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

function createScalarCursorCodec<Source extends IngestionSource>(
  source: Source,
  schema: z.ZodType<DurableCursorFor<Source>>,
  fromInteger: (value: number) => DurableCursorFor<Source>,
  toInteger: (cursor: DurableCursorFor<Source>) => number,
): DurableCursorCodec<Source> {
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

function createPairCursorCodec<Source extends IngestionSource>(
  source: Source,
  schema: z.ZodType<DurableCursorFor<Source>>,
  fromPair: (first: number, second: number) => DurableCursorFor<Source>,
  toPair: (cursor: DurableCursorFor<Source>) => readonly [number, number],
): DurableCursorCodec<Source> {
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

const Row52CursorCodec = createJsonCursorCodec("row52", Row52CursorSchema);
const PypCursorCodec = createScalarCursorCodec(
  "pyp",
  PypCursorSchema,
  (page) => ({ source: "pyp", page }),
  (cursor) => cursor.page,
);
const AutorecyclerCursorCodec = createScalarCursorCodec(
  "autorecycler",
  AutorecyclerCursorSchema,
  (from) => ({ source: "autorecycler", from }),
  (cursor) => cursor.from,
);
const PullapartCursorCodec = createPairCursorCodec(
  "pullapart",
  PullapartCursorSchema,
  (locationId, makeId) => ({ source: "pullapart", locationId, makeId }),
  (cursor) => [cursor.locationId, cursor.makeId],
);
const UpullitneCursorCodec = createScalarCursorCodec(
  "upullitne",
  UpullitneCursorSchema,
  (storeIndex) => ({ source: "upullitne", storeIndex }),
  (cursor) => cursor.storeIndex,
);
const UpullitDavieCursorCodec = createJsonCursorCodec(
  "upullitdavie",
  UpullitDavieCursorSchema,
);
const GopullitCursorCodec = createJsonCursorCodec(
  "gopullit",
  GopullitCursorSchema,
);

const DURABLE_CURSOR_CODECS: DurableCursorCodecRegistry = {
  row52: Row52CursorCodec,
  pyp: PypCursorCodec,
  autorecycler: AutorecyclerCursorCodec,
  pullapart: PullapartCursorCodec,
  upullitne: UpullitneCursorCodec,
  upullitdavie: UpullitDavieCursorCodec,
  gopullit: GopullitCursorCodec,
};

export function parseDurableSourceCursor<Source extends IngestionSource>(
  source: Source,
  value: string,
): DurableCursorFor<Source> {
  return DURABLE_CURSOR_CODECS[source].parse(value);
}

export function serializeDurableSourceCursor(
  cursor: DurableSourceCursor,
): string {
  switch (cursor.source) {
    case "row52":
      return Row52CursorCodec.serialize(cursor);
    case "pyp":
      return PypCursorCodec.serialize(cursor);
    case "autorecycler":
      return AutorecyclerCursorCodec.serialize(cursor);
    case "pullapart":
      return PullapartCursorCodec.serialize(cursor);
    case "upullitne":
      return UpullitneCursorCodec.serialize(cursor);
    case "upullitdavie":
      return UpullitDavieCursorCodec.serialize(cursor);
    case "gopullit":
      return GopullitCursorCodec.serialize(cursor);
  }
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
