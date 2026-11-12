import { z } from "zod";
import { AutorecyclerCursorSchema } from "./autorecycler-cursor";
import { WrenchApartCursorSchema } from "./wrenchapart-cursor";
import { UpullitwaCursorSchema } from "./upullitwa-cursor";
import { RtpCursorSchema } from "./rtp-cursor";
import { NvpapCursorSchema } from "./nvpap-cursor";
import { PontiacCursorSchema } from "./pontiac-cursor";
import { AeroCursorSchema } from "./aero-cursor";
import { ChesterfieldCursorSchema } from "./chesterfield-cursor";
import { MidwayCursorSchema } from "./midway-cursor";
import { DdautoCursorSchema } from "./ddauto-cursor";
import { RivervalleyCursorSchema } from "./rivervalley-cursor";
import { FenixCursorSchema } from "./fenix-cursor";
import { ImportapartCursorSchema } from "./importapart-cursor";
import { BigtruckpageCursorSchema } from "./bigtruckpage-cursor";
import { BeaversCursor } from "./beavers-cursor";
import { IndianriverCursor } from "./indianriver-cursor";
import { DentonCursor } from "./denton-cursor";
import { OemCursorSchema, type OemCursor } from "./oem-cursor";
import { DutchersCursor } from "./dutchers-cursor";
import { ChasencarsCursor } from "./chasencars-cursor";
import { OemgarageCursor } from "./oemgarage-cursor";
import { HagermanCursorSchema, type HagermanCursor } from "./hagerman-cursor";
import { KandrCursor } from "./kandr-cursor";
import { KANDR_CONTRACT } from "./kandr-configuration";
import { JimsimportCursor } from "./jimsimport-cursor";
import { ArmyCursorSchema } from "./army-cursor";
import { IdipullCursorSchema } from "./idipull-cursor";
import { LittletonCursorSchema } from "./littleton-cursor";
import { MichigantruckCursorSchema } from "./michigantruck-cursor";
import { JolietCursorSchema } from "./joliet-cursor";
import { Alln1CursorSchema } from "./alln1-cursor";
import { MillerstownCursorSchema } from "./millerstown-cursor";
import { PickapartvaCursorSchema } from "./pickapartva-cursor";
import { MccauleyCursorSchema } from "./mccauley-cursor";
import { AviationCursor } from "./aviation-cursor";
import { ChazCursor } from "./chaz-cursor";
import { CitymotorsCursor } from "./citymotors-cursor";
import { AwapCursor } from "./awap-cursor";
import { ClearsalvageCursor } from "./clearsalvage-cursor";
import { AplusCursor } from "./aplus-cursor";
import { CentralCursor } from "./central-cursor";
import { CoutuCursor } from "./coutu-cursor";
import { KodakCursor } from "./kodak-cursor";
import { Cars4PartsCursor } from "./cars4parts-cursor";
import { CARS4PARTS_CONTRACT } from "./cars4parts-configuration";
import { MeeksCursorSchema } from "./meeks-cursor";
import { BrandywineCursor } from "./brandywine-cursor";
import { CaltonCursor } from "./calton-cursor";
import { CALTON_CONTRACT } from "./calton-configuration";
import {
  UpullRPartsCursor,
  UpullRPartsCursorSchema,
} from "./upullrparts-cursor";
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

/** A JSON cursor that also accepts checkpoints from an earlier format. */
function defineLegacyJsonCursor<
  Source extends IngestionSource,
  Cursor extends SourceCursor<Source>,
>(
  source: Source,
  schema: z.ZodType<Cursor>,
  legacy: Readonly<Record<string, Cursor>>,
): DurableCursorDefinition<Cursor> {
  const json = defineJsonCursor(source, schema);
  return {
    parse: (value) => legacy[value] ?? json.parse(value),
    serialize: json.serialize,
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

const PypInitialCursorSchema = z
  .object({
    source: z.literal("pyp"),
    storeCodes: z.null(),
    storeIndex: z.literal(0),
    page: z.literal(0),
  })
  .strict();
const PypActiveCursorSchema = z
  .object({
    source: z.literal("pyp"),
    storeCodes: z.array(z.string().min(1)).min(20),
    storeIndex: NonNegativeIntegerSchema,
    page: NonNegativeIntegerSchema,
  })
  .strict()
  .refine(
    (cursor) =>
      cursor.storeCodes.every((code, index) => {
        const previous = cursor.storeCodes[index - 1];
        return previous === undefined || previous < code;
      }) &&
      (cursor.storeIndex < cursor.storeCodes.length ||
        (cursor.storeIndex === cursor.storeCodes.length && cursor.page === 0)),
  );
const PypStoreCursorSchema = z.union([
  PypInitialCursorSchema,
  PypActiveCursorSchema,
]);

export type PypStoreCursor = z.infer<typeof PypStoreCursorSchema>;
export type PypActiveCursor = z.infer<typeof PypActiveCursorSchema>;

const autorecyclerJsonCursor = defineJsonCursor(
  "autorecycler",
  AutorecyclerCursorSchema,
);

const oemJsonCursor = defineJsonCursor("oem", OemCursorSchema);
const hagermanJsonCursor = defineJsonCursor("hagerman", HagermanCursorSchema);

const DURABLE_CURSOR_DEFINITIONS = {
  jimsimport: {
    parse: (value: string) => {
      if (Buffer.byteLength(value) > 8 * 1024 * 1024)
        throw new Error("Jim's Import serialized checkpoint exceeds 8 MiB");
      const payload: unknown = JSON.parse(value);
      return JimsimportCursor.parse(payload);
    },
    serialize: (cursor: JimsimportCursor) => {
      const wire = JSON.stringify(JimsimportCursor.parse(cursor));
      if (Buffer.byteLength(wire) > 8 * 1024 * 1024)
        throw new Error("Jim's Import serialized checkpoint exceeds 8 MiB");
      return wire;
    },
  },
  kandr: {
    parse: (value: string) => {
      const parsed = KandrCursor.fromWire(value, KANDR_CONTRACT);
      if (!parsed.ok) throw new Error(parsed.error.message);
      return parsed.value;
    },
    serialize: (cursor: KandrCursor) => {
      const serialized = KandrCursor.serialize(cursor, KANDR_CONTRACT);
      if (!serialized.ok) throw new Error(serialized.error.message);
      return serialized.value;
    },
  },
  hagerman: {
    parse: (value: string) => {
      if (Buffer.byteLength(value) > 2 * 1024 * 1024)
        throw new Error("Hagerman serialized checkpoint exceeds 2 MiB");
      return hagermanJsonCursor.parse(value);
    },
    serialize: (cursor: HagermanCursor) => {
      const wire = hagermanJsonCursor.serialize(cursor);
      if (Buffer.byteLength(wire) > 2 * 1024 * 1024)
        throw new Error("Hagerman serialized checkpoint exceeds 2 MiB");
      return wire;
    },
  },
  oemgarage: {
    parse: (value: string) => {
      if (Buffer.byteLength(value) > 4 * 1024 * 1024)
        throw new Error("oeM Garage serialized checkpoint exceeds 4 MiB");
      const payload: unknown = JSON.parse(value);
      return OemgarageCursor.parse(payload);
    },
    serialize: (cursor: OemgarageCursor) => {
      const wire = JSON.stringify(OemgarageCursor.parse(cursor));
      if (Buffer.byteLength(wire) > 4 * 1024 * 1024)
        throw new Error("oeM Garage serialized checkpoint exceeds 4 MiB");
      return wire;
    },
  },
  chasencars: {
    parse: ChasencarsCursor.fromWire,
    serialize: ChasencarsCursor.serialize,
  },
  dutchers: {
    parse: (value: string) => {
      if (Buffer.byteLength(value) > 8 * 1024 * 1024)
        throw new Error("Dutcher serialized checkpoint exceeds 8 MiB");
      const payload: unknown = JSON.parse(value);
      return DutchersCursor.parse(payload);
    },
    serialize: (cursor: DutchersCursor) => {
      const wire = JSON.stringify(DutchersCursor.parse(cursor));
      if (Buffer.byteLength(wire) > 8 * 1024 * 1024)
        throw new Error("Dutcher serialized checkpoint exceeds 8 MiB");
      return wire;
    },
  },
  oem: {
    parse: (value: string) => {
      if (Buffer.byteLength(value) > 4 * 1024 * 1024)
        throw new Error("OEM serialized checkpoint exceeds 4 MiB");
      return oemJsonCursor.parse(value);
    },
    serialize: (cursor: OemCursor) => {
      const wire = oemJsonCursor.serialize(cursor);
      if (Buffer.byteLength(wire) > 4 * 1024 * 1024)
        throw new Error("OEM serialized checkpoint exceeds 4 MiB");
      return wire;
    },
  },
  indianriver: {
    parse: (value: string) => {
      if (Buffer.byteLength(value) > 8 * 1024 * 1024)
        throw new Error("Indian River serialized checkpoint exceeds 8 MiB");
      const payload: unknown = JSON.parse(value);
      return IndianriverCursor.parse(payload);
    },
    serialize: (cursor: IndianriverCursor) =>
      JSON.stringify(IndianriverCursor.parse(cursor)),
  },
  denton: {
    parse: (value: string) => {
      const parsed = DentonCursor.fromWire(value, null);
      if (!parsed.ok) throw new Error(parsed.error.message);
      return parsed.value;
    },
    serialize: (cursor: DentonCursor) => {
      const serialized = DentonCursor.serialize(cursor, null);
      if (!serialized.ok) throw new Error(serialized.error.message);
      return serialized.value;
    },
  },
  beavers: {
    parse: BeaversCursor.parse,
    serialize: BeaversCursor.serialize,
  },
  row52: defineJsonCursor(
    "row52",
    z.object({
      source: z.literal("row52"),
      afterLocationId: NonNegativeIntegerSchema,
      locationIds: z.array(NonNegativeIntegerSchema),
      skip: NonNegativeIntegerSchema,
    }),
  ),
  pyp: defineJsonCursor("pyp", PypStoreCursorSchema),
  // Offset checkpoints cannot prove which record-ID range has been visited.
  // Reject legacy cursors so an old partial snapshot cannot become accepted.
  autorecycler: {
    ...autorecyclerJsonCursor,
    parse: (value: string) => {
      if (/^\d+$/.test(value))
        throw new Error(
          "Legacy AutoRecycler offset checkpoints cannot establish complete feed traversal. Start a new ingestion run; previously published inventory is preserved.",
        );
      return autorecyclerJsonCursor.parse(value);
    },
  },
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
  pullnsave: defineScalarCursor(
    "pullnsave",
    z.object({
      source: z.literal("pullnsave"),
      page: PositiveIntegerSchema,
    }),
    (page) => ({ source: "pullnsave", page }),
    (cursor) => cursor.page,
  ),
  tearapart: defineScalarCursor(
    "tearapart",
    z.object({
      source: z.literal("tearapart"),
      storeIndex: NonNegativeIntegerSchema,
    }),
    (storeIndex) => ({ source: "tearapart", storeIndex }),
    (cursor) => cursor.storeIndex,
  ),
  wrenchapart: defineJsonCursor("wrenchapart", WrenchApartCursorSchema),
  upullrparts: defineLegacyJsonCursor(
    "upullrparts",
    UpullRPartsCursorSchema,
    // Runs started before the make crawl stored a scalar catalog checkpoint.
    {
      "0": UpullRPartsCursor.initial,
      "1": { source: "upullrparts", phase: "complete", storesSeen: [] },
    },
  ),
  ipullupull: defineScalarCursor(
    "ipullupull",
    z.object({
      source: z.literal("ipullupull"),
      catalog: z.union([z.literal(0), z.literal(1)]),
    }),
    (value): { source: "ipullupull"; catalog: 0 | 1 } => {
      if (value !== 0 && value !== 1)
        throw invalidCursor("ipullupull", String(value));
      return { source: "ipullupull", catalog: value };
    },
    (cursor) => cursor.catalog,
  ),
  upullitwa: defineJsonCursor("upullitwa", UpullitwaCursorSchema),
  rtp: defineJsonCursor("rtp", RtpCursorSchema),
  nvpap: defineJsonCursor("nvpap", NvpapCursorSchema),
  pontiac: defineJsonCursor("pontiac", PontiacCursorSchema),
  aero: defineJsonCursor("aero", AeroCursorSchema),
  chesterfield: defineJsonCursor("chesterfield", ChesterfieldCursorSchema),
  midway: defineJsonCursor("midway", MidwayCursorSchema),
  ddauto: defineJsonCursor("ddauto", DdautoCursorSchema),
  rivervalley: defineJsonCursor("rivervalley", RivervalleyCursorSchema),
  fenix: defineJsonCursor("fenix", FenixCursorSchema),
  importapart: defineJsonCursor("importapart", ImportapartCursorSchema),
  bigtruckpage: defineJsonCursor("bigtruckpage", BigtruckpageCursorSchema),
  army: defineJsonCursor("army", ArmyCursorSchema),
  idipull: defineJsonCursor("idipull", IdipullCursorSchema),
  littleton: defineJsonCursor("littleton", LittletonCursorSchema),
  michigantruck: defineJsonCursor("michigantruck", MichigantruckCursorSchema),
  joliet: defineJsonCursor("joliet", JolietCursorSchema),
  alln1: defineJsonCursor("alln1", Alln1CursorSchema),
  millerstown: defineJsonCursor("millerstown", MillerstownCursorSchema),
  pickapartva: defineJsonCursor("pickapartva", PickapartvaCursorSchema),
  mccauley: defineJsonCursor("mccauley", MccauleyCursorSchema),
  aviation: {
    parse: AviationCursor.parse,
    serialize: AviationCursor.serialize,
  },
  chaz: {
    parse: ChazCursor.parse,
    serialize: ChazCursor.serialize,
  },
  citymotors: {
    parse: CitymotorsCursor.parse,
    serialize: CitymotorsCursor.serialize,
  },
  awap: {
    parse: AwapCursor.parse,
    serialize: AwapCursor.serialize,
  },
  clearsalvage: {
    parse: ClearsalvageCursor.parse,
    serialize: ClearsalvageCursor.serialize,
  },
  aplus: {
    parse: AplusCursor.parse,
    serialize: AplusCursor.serialize,
  },
  central: {
    parse: CentralCursor.parse,
    serialize: CentralCursor.serialize,
  },
  coutu: {
    parse: CoutuCursor.parse,
    serialize: CoutuCursor.serialize,
  },
  kodak: {
    parse: KodakCursor.parse,
    serialize: KodakCursor.serialize,
  },
  cars4parts: {
    parse: (value: string) => {
      const payload: unknown = JSON.parse(value);
      const parsed = Cars4PartsCursor.parse(payload, CARS4PARTS_CONTRACT);
      if (!parsed.ok) throw new Error(parsed.error.message);
      return parsed.value;
    },
    serialize: (cursor: Cars4PartsCursor) => {
      const parsed = Cars4PartsCursor.parse(cursor, CARS4PARTS_CONTRACT);
      if (!parsed.ok) throw new Error(parsed.error.message);
      return JSON.stringify(parsed.value);
    },
  },
  meeks: defineJsonCursor("meeks", MeeksCursorSchema),
  brandywine: {
    parse: BrandywineCursor.parse,
    serialize: BrandywineCursor.serialize,
  },
  calton: {
    parse: (value: string) => {
      const parsed = CaltonCursor.fromWire(value, CALTON_CONTRACT);
      if (!parsed.ok) throw new Error(parsed.error.message);
      return parsed.value;
    },
    serialize: (cursor: CaltonCursor) => {
      const serialized = CaltonCursor.serialize(cursor, CALTON_CONTRACT);
      if (!serialized.ok) throw new Error(serialized.error.message);
      return serialized.value;
    },
  },
  partsgalore: defineScalarCursor(
    "partsgalore",
    z.object({
      source: z.literal("partsgalore"),
      catalog: z.union([z.literal(0), z.literal(1)]),
    }),
    (value): { source: "partsgalore"; catalog: 0 | 1 } => {
      if (value !== 0 && value !== 1)
        throw invalidCursor("partsgalore", String(value));
      return { source: "partsgalore", catalog: value };
    },
    (cursor) => cursor.catalog,
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
