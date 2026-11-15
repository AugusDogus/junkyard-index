import { HeavytruckpartsCursor } from "./heavytruckparts-cursor";
import type { ConnectorChunkStatus } from "./connector-chunk";
import { CstruckCursor } from "./cstruck-cursor";
import { ByotCursor } from "./byot-cursor";
import { AlliedCursor } from "./allied-cursor";
import { ALLIED_CONTRACT } from "./allied-configuration";
import { PontiacCursor } from "./pontiac-cursor";
import { AutorecyclerCursor } from "./autorecycler-cursor";
import { AeroCursor } from "./aero-cursor";
import { ChesterfieldCursor } from "./chesterfield-cursor";
import { UtpapCursor } from "./utpap-cursor";
import { TritownCursor } from "./tritown-cursor";
import { WhitebradstreetCursor } from "./whitebradstreet-cursor";
import { MidwayCursor } from "./midway-cursor";
import { RightwayCursor } from "./rightway-cursor";
import { DdautoCursor } from "./ddauto-cursor";
import { RivervalleyCursor } from "./rivervalley-cursor";
import { FenixCursor } from "./fenix-cursor";
import { ImportapartCursor } from "./importapart-cursor";
import { BigtruckpageCursor } from "./bigtruckpage-cursor";
import { SpeedysCursor } from "./speedys-cursor";
import { SandwCursor } from "./sandw-cursor";
import { BeaversCursor } from "./beavers-cursor";
import { IndianriverCursor } from "./indianriver-cursor";
import { DentonCursor } from "./denton-cursor";
import { ScottsCursor } from "./scotts-cursor";
import { OemCursor } from "./oem-cursor";
import { DutchersCursor } from "./dutchers-cursor";
import { ChasencarsCursor } from "./chasencars-cursor";
import { WeberbrothersCursor } from "./weberbrothers-cursor";
import { HawaiipartsCursor } from "./hawaiiparts-cursor";
import { ModernmuscleCursor } from "./modernmuscle-cursor";
import { OemgarageCursor } from "./oemgarage-cursor";
import { HagermanCursor } from "./hagerman-cursor";
import { KandrCursor } from "./kandr-cursor";
import { KANDR_CONTRACT } from "./kandr-configuration";
import { JimsimportCursor } from "./jimsimport-cursor";
import { LonestarimportsCursor } from "./lonestarimports-cursor";
import { HollanderstoresCursor } from "./hollanderstores-cursor";
import { AlshnedCursor } from "./alshned-cursor";
import { ArmyCursor } from "./army-cursor";
import { IdipullCursor } from "./idipull-cursor";
import { PullsavewaCursor } from "./pullsavewa-cursor";
import { LittletonCursor } from "./littleton-cursor";
import { MichigantruckCursor } from "./michigantruck-cursor";
import { JolietCursor } from "./joliet-cursor";
import { Alln1Cursor } from "./alln1-cursor";
import { PickersCoverageCursor } from "./pickers-coverage-cursor";
import { PipesCursor } from "./pipes-cursor";
import { UwrenchCursor } from "./uwrench-cursor";
import { MillerstownCursor } from "./millerstown-cursor";
import { PickapartvaCursor } from "./pickapartva-cursor";
import { MccauleyCursor } from "./mccauley-cursor";
import { RustyhookCursor } from "./rustyhook-cursor";
import { AviationCursor } from "./aviation-cursor";
import { ChazCursor } from "./chaz-cursor";
import { CitymotorsCursor } from "./citymotors-cursor";
import { AwapCursor } from "./awap-cursor";
import { ClearsalvageCursor } from "./clearsalvage-cursor";
import { AplusCursor } from "./aplus-cursor";
import { CentralCursor } from "./central-cursor";
import { NorthwestCursor } from "./northwest-cursor";
import { CoutuCursor } from "./coutu-cursor";
import { KodakCursor } from "./kodak-cursor";
import { Six03Cursor } from "./six03-cursor";
import { RohnerCursor } from "./rohner-cursor";
import { PrattCursor } from "./pratt-cursor";
import { PRATT_CONTRACT } from "./pratt-configuration";
import { Cars4PartsCursor } from "./cars4parts-cursor";
import { CARS4PARTS_CONTRACT } from "./cars4parts-configuration";
import { MeeksCursor } from "./meeks-cursor";
import { BrandywineCursor } from "./brandywine-cursor";
import { RmmdtpCursor } from "./rmmdtp-cursor";
import { RMMDTP_CONTRACT } from "./rmmdtp-configuration";
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
const initialKandr = KandrCursor.initial(KANDR_CONTRACT);
if (!initialKandr.ok) throw new Error(initialKandr.error.message);
const initialDenton = DentonCursor.initial(null);
if (!initialDenton.ok) throw new Error(initialDenton.error.message);

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
  rtp: {
    initialCursor: { source: "rtp", phase: "start", yardCode: "595" },
    maxPagesPerChunk: 2,
  },
  nvpap: {
    initialCursor: { source: "nvpap", phase: "start", yardCode: "1074" },
    maxPagesPerChunk: 16,
  },
  pontiac: { initialCursor: PontiacCursor.initial, maxPagesPerChunk: 16 },
  aero: { initialCursor: AeroCursor.initial, maxPagesPerChunk: 1 },
  chesterfield: {
    initialCursor: ChesterfieldCursor.initial,
    maxPagesPerChunk: 16,
  },
  utpap: { initialCursor: UtpapCursor.initial, maxPagesPerChunk: 16 },
  tritown: { initialCursor: TritownCursor.initial, maxPagesPerChunk: 16 },
  whitebradstreet: {
    initialCursor: WhitebradstreetCursor.initial,
    maxPagesPerChunk: 8,
  },
  midway: { initialCursor: MidwayCursor.initial, maxPagesPerChunk: 2 },
  rightway: { initialCursor: RightwayCursor.initial, maxPagesPerChunk: 1 },
  ddauto: { initialCursor: DdautoCursor.initial, maxPagesPerChunk: 1 },
  rivervalley: {
    initialCursor: RivervalleyCursor.initial,
    maxPagesPerChunk: 8,
  },
  fenix: { initialCursor: FenixCursor.initial, maxPagesPerChunk: 16 },
  importapart: {
    initialCursor: ImportapartCursor.initial,
    maxPagesPerChunk: 16,
  },
  army: { initialCursor: ArmyCursor.initial, maxPagesPerChunk: 1 },
  idipull: { initialCursor: IdipullCursor.initial, maxPagesPerChunk: 1 },
  pullsavewa: { initialCursor: PullsavewaCursor.initial, maxPagesPerChunk: 1 },
  littleton: { initialCursor: LittletonCursor.initial, maxPagesPerChunk: 16 },
  michigantruck: {
    initialCursor: MichigantruckCursor.initial,
    maxPagesPerChunk: 1,
  },
  joliet: { initialCursor: JolietCursor.initial, maxPagesPerChunk: 16 },
  alln1: { initialCursor: Alln1Cursor.initial, maxPagesPerChunk: 3 },
  pickers: {
    initialCursor: PickersCoverageCursor.initial,
    maxPagesPerChunk: 16,
  },
  pipes: { initialCursor: PipesCursor.initial, maxPagesPerChunk: 8 },
  uwrench: { initialCursor: UwrenchCursor.initial, maxPagesPerChunk: 16 },
  millerstown: {
    initialCursor: MillerstownCursor.initial,
    maxPagesPerChunk: 1,
  },
  pickapartva: {
    initialCursor: PickapartvaCursor.initial,
    maxPagesPerChunk: 15,
  },
  mccauley: { initialCursor: MccauleyCursor.initial, maxPagesPerChunk: 8 },
  rustyhook: { initialCursor: RustyhookCursor.initial, maxPagesPerChunk: 3 },
  aviation: { initialCursor: AviationCursor.initial, maxPagesPerChunk: 8 },
  chaz: { initialCursor: ChazCursor.initial, maxPagesPerChunk: 8 },
  citymotors: { initialCursor: CitymotorsCursor.initial, maxPagesPerChunk: 8 },
  awap: { initialCursor: AwapCursor.initial, maxPagesPerChunk: 8 },
  clearsalvage: {
    initialCursor: ClearsalvageCursor.initial,
    maxPagesPerChunk: 8,
  },
  aplus: { initialCursor: AplusCursor.initial, maxPagesPerChunk: 8 },
  central: { initialCursor: CentralCursor.initial, maxPagesPerChunk: 8 },
  northwest: { initialCursor: NorthwestCursor.initial, maxPagesPerChunk: 8 },
  coutu: { initialCursor: CoutuCursor.initial, maxPagesPerChunk: 8 },
  kodak: { initialCursor: KodakCursor.initial, maxPagesPerChunk: 2 },
  six03: { initialCursor: Six03Cursor.initial, maxPagesPerChunk: 8 },
  rohner: { initialCursor: RohnerCursor.initial, maxPagesPerChunk: 3 },
  pratt: {
    initialCursor: PrattCursor.initial(PRATT_CONTRACT),
    maxPagesPerChunk: 8,
  },
  cars4parts: {
    initialCursor: Cars4PartsCursor.initial(CARS4PARTS_CONTRACT),
    maxPagesPerChunk: 8,
  },
  meeks: { initialCursor: MeeksCursor.initial, maxPagesPerChunk: 1 },
  brandywine: {
    initialCursor: BrandywineCursor.initial(null),
    maxPagesPerChunk: 3,
  },
  rmmdtp: {
    initialCursor: RmmdtpCursor.initial(RMMDTP_CONTRACT),
    maxPagesPerChunk: 8,
  },
  calton: {
    initialCursor: initialCalton.value,
    maxPagesPerChunk: 8,
  },
  bigtruckpage: {
    initialCursor: BigtruckpageCursor.initial,
    maxPagesPerChunk: 2,
  },
  speedys: {
    initialCursor: SpeedysCursor.initial,
    maxPagesPerChunk: 2,
  },
  sandw: {
    initialCursor: SandwCursor.initial(),
    maxPagesPerChunk: 5,
  },
  denton: {
    initialCursor: initialDenton.value,
    maxPagesPerChunk: 8,
  },
  beavers: {
    initialCursor: BeaversCursor.initial,
    maxPagesPerChunk: 8,
  },
  indianriver: {
    initialCursor: IndianriverCursor.initial(),
    maxPagesPerChunk: 8,
  },
  scotts: {
    initialCursor: ScottsCursor.initial,
    maxPagesPerChunk: 6,
  },
  oem: {
    initialCursor: OemCursor.initial(),
    maxPagesPerChunk: 8,
  },
  dutchers: {
    initialCursor: DutchersCursor.initial(),
    maxPagesPerChunk: 8,
  },
  chasencars: {
    initialCursor: ChasencarsCursor.initial(null),
    maxPagesPerChunk: 6,
  },
  weberbrothers: {
    initialCursor: WeberbrothersCursor.initial,
    maxPagesPerChunk: 10,
  },
  hawaiiparts: {
    initialCursor: HawaiipartsCursor.initial(),
    maxPagesPerChunk: 4,
  },
  modernmuscle: {
    initialCursor: ModernmuscleCursor.initial(),
    maxPagesPerChunk: 4,
  },
  oemgarage: {
    initialCursor: OemgarageCursor.initial(),
    maxPagesPerChunk: 8,
  },
  hagerman: {
    initialCursor: HagermanCursor.initial,
    maxPagesPerChunk: 12,
  },
  kandr: {
    initialCursor: initialKandr.value,
    maxPagesPerChunk: 8,
  },
  jimsimport: {
    initialCursor: JimsimportCursor.initial(),
    maxPagesPerChunk: 8,
  },
  lonestarimports: {
    initialCursor: LonestarimportsCursor.initial(null),
    maxPagesPerChunk: 8,
  },
  alshned: {
    initialCursor: AlshnedCursor.initial,
    maxPagesPerChunk: 12,
  },
  hollanderstores: {
    initialCursor: HollanderstoresCursor.initial(),
    maxPagesPerChunk: 1,
  },
  cstruck: { initialCursor: CstruckCursor.initial(), maxPagesPerChunk: 8 },
  heavytruckparts: {
    initialCursor: HeavytruckpartsCursor.initial(),
    maxPagesPerChunk: 8,
  },
  allied: {
    initialCursor: AlliedCursor.initial(ALLIED_CONTRACT),
    maxPagesPerChunk: 4,
  },
  byot: { initialCursor: ByotCursor.initial(), maxPagesPerChunk: 8 },
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
