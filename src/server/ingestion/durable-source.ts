import { AlsautoCursor } from "./alsauto-cursor";
import { HarrysCursor } from "./harrys-cursor";
import { BudgetCursor } from "./budget-cursor";
import { HeavytruckpartsCursor } from "./heavytruckparts-cursor";
import { VinplusCursor } from "./vinplus-cursor";
import { UrgiisCursor } from "./urgiis-cursor";
import type { ConnectorChunkStatus } from "./connector-chunk";
import { CstruckCursor } from "./cstruck-cursor";
import { BYOT_CHUNK_REQUESTS, ByotCursor } from "./byot-cursor";
import { AlliedCursor } from "./allied-cursor";
import { ALLIED_CONTRACT } from "./allied-configuration";
import { PontiacCursor } from "./pontiac-cursor";
import { AutorecyclerCursor } from "./autorecycler-cursor";
import { VanderHaagsCursor } from "./vanderhaags-cursor";
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
import { CarsandpartsCursor } from "./carsandparts-cursor";
import { SpartanCursor } from "./spartan-cursor";
import { OemgarageCursor } from "./oemgarage-cursor";
import { HagermanCursor } from "./hagerman-cursor";
import { KandrCursor } from "./kandr-cursor";
import { KANDR_CONTRACT } from "./kandr-configuration";
import { JimsimportCursor } from "./jimsimport-cursor";
import { LonestarimportsCursor } from "./lonestarimports-cursor";
import { HollanderstoresDurableCursor } from "./hollanderstores-durable-cursor";
import { AlshnedCursor } from "./alshned-cursor";
import { ArmyCursor } from "./army-cursor";
import { BigdCursor } from "./bigd-cursor";
import { IdipullCursor } from "./idipull-cursor";
import { PullsavewaCursor } from "./pullsavewa-cursor";
import { LittletonCursor } from "./littleton-cursor";
import { MichigantruckCursor } from "./michigantruck-cursor";
import { JolietCursor } from "./joliet-cursor";
import { Alln1Cursor, GrandpajohnsCursor } from "./alln1-cursor";
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
  parseDurableSourceCursor,
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

/**
 * How source validation proves that a successful run's final checkpoint
 * finished the crawl, so partial inventory is never published as complete.
 */
export type DurableSourceTerminal<Cursor> =
  /** The cursor records completion. `isTerminal` is false mid-crawl. */
  | { kind: "cursor"; isTerminal: (cursor: Cursor) => boolean }
  /**
   * The final cursor is indistinguishable from a mid-crawl one, so only the
   * connector's "complete" status proves the crawl finished. `reason` says
   * why the cursor cannot carry that proof.
   */
  | { kind: "connector-status"; reason: string };

type DurableSourceDefinition<Source extends IngestionSource> = {
  initialCursor: DurableCursorFor<Source>;
  maxPagesPerChunk: number;
  terminal: DurableSourceTerminal<DurableCursorFor<Source>>;
};

const COMPLETE_PHASE = {
  kind: "cursor",
  isTerminal: (cursor: { phase: string }) => cursor.phase === "complete",
} as const;

function connectorStatusOnly(reason: string) {
  return { kind: "connector-status", reason } as const;
}

const LIVE_DIRECTORY_REASON =
  "the cursor stores the last visited position, and completion depends on the live yard directory fetched each chunk";
const SHORT_PAGE_REASON =
  "the cursor stores the next page number, and completion depends on the provider returning a short page";

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
    terminal: connectorStatusOnly(LIVE_DIRECTORY_REASON),
  },
  pyp: {
    initialCursor: {
      source: "pyp",
      storeCodes: null,
      storeIndex: 0,
      page: 0,
    },
    maxPagesPerChunk: 30,
    terminal: {
      kind: "cursor",
      isTerminal: (cursor) =>
        cursor.storeCodes !== null &&
        cursor.storeIndex === cursor.storeCodes.length,
    },
  },
  autorecycler: {
    initialCursor: {
      source: "autorecycler",
      phase: "freshness",
    } satisfies AutorecyclerCursor,
    maxPagesPerChunk: 10,
    terminal: {
      kind: "cursor",
      isTerminal: (cursor) =>
        cursor.phase === "complete" && cursor.freshness !== undefined,
    },
  },
  pullapart: {
    initialCursor: { source: "pullapart", locationId: 0, makeId: 0 },
    maxPagesPerChunk: 10,
    terminal: connectorStatusOnly(LIVE_DIRECTORY_REASON),
  },
  upullitne: {
    initialCursor: { source: "upullitne", storeIndex: 0 },
    maxPagesPerChunk: 5,
    terminal: connectorStatusOnly(LIVE_DIRECTORY_REASON),
  },
  upullitdavie: {
    initialCursor: {
      source: "upullitdavie",
      ...UpullitDavieCursorState.initial,
    },
    maxPagesPerChunk: 24,
    terminal: {
      kind: "cursor",
      isTerminal: (cursor) =>
        cursor.totalPages !== null && cursor.page > cursor.totalPages,
    },
  },
  gopullit: {
    initialCursor: {
      source: "gopullit",
      ...GopullitCursorState.initial,
    },
    maxPagesPerChunk: 24,
    terminal: connectorStatusOnly(SHORT_PAGE_REASON),
  },
  pullnsave: {
    initialCursor: { source: "pullnsave", page: 1 },
    maxPagesPerChunk: 10,
    terminal: connectorStatusOnly(SHORT_PAGE_REASON),
  },
  tearapart: {
    initialCursor: { source: "tearapart", storeIndex: 0 },
    maxPagesPerChunk: 5,
    terminal: connectorStatusOnly(LIVE_DIRECTORY_REASON),
  },
  wrenchapart: {
    initialCursor: { source: "wrenchapart", afterLocationId: 0 },
    maxPagesPerChunk: 1,
    terminal: connectorStatusOnly(LIVE_DIRECTORY_REASON),
  },
  upullrparts: {
    initialCursor: UpullRPartsCursor.initial,
    maxPagesPerChunk: 1,
    terminal: COMPLETE_PHASE,
  },
  ipullupull: {
    initialCursor: { source: "ipullupull", catalog: 0 },
    maxPagesPerChunk: 1,
    terminal: { kind: "cursor", isTerminal: (cursor) => cursor.catalog === 1 },
  },
  upullitwa: {
    initialCursor: { source: "upullitwa", phase: "start" },
    maxPagesPerChunk: 2,
    terminal: COMPLETE_PHASE,
  },
  partsgalore: {
    initialCursor: { source: "partsgalore", catalog: 0 },
    maxPagesPerChunk: 1,
    terminal: { kind: "cursor", isTerminal: (cursor) => cursor.catalog === 1 },
  },
  rtp: {
    initialCursor: { source: "rtp", phase: "start", yardCode: "595" },
    maxPagesPerChunk: 2,
    terminal: COMPLETE_PHASE,
  },
  nvpap: {
    initialCursor: { source: "nvpap", phase: "start", yardCode: "1074" },
    maxPagesPerChunk: 16,
    terminal: COMPLETE_PHASE,
  },
  pontiac: {
    initialCursor: PontiacCursor.initial,
    maxPagesPerChunk: 16,
    terminal: COMPLETE_PHASE,
  },
  aero: {
    initialCursor: AeroCursor.initial,
    maxPagesPerChunk: 1,
    terminal: COMPLETE_PHASE,
  },
  vanderhaags: {
    initialCursor: VanderHaagsCursor.initial,
    maxPagesPerChunk: 12,
    terminal: {
      kind: "cursor",
      isTerminal: (cursor) =>
        cursor.phase === "complete" && cursor.census !== undefined,
    },
  },
  chesterfield: {
    initialCursor: ChesterfieldCursor.initial,
    maxPagesPerChunk: 16,
    terminal: COMPLETE_PHASE,
  },
  utpap: {
    initialCursor: UtpapCursor.initial,
    maxPagesPerChunk: 16,
    terminal: COMPLETE_PHASE,
  },
  tritown: {
    initialCursor: TritownCursor.initial,
    maxPagesPerChunk: 16,
    terminal: COMPLETE_PHASE,
  },
  whitebradstreet: {
    initialCursor: WhitebradstreetCursor.initial,
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
  midway: {
    initialCursor: MidwayCursor.initial,
    maxPagesPerChunk: 2,
    terminal: COMPLETE_PHASE,
  },
  rightway: {
    initialCursor: RightwayCursor.initial,
    maxPagesPerChunk: 1,
    terminal: COMPLETE_PHASE,
  },
  ddauto: {
    initialCursor: DdautoCursor.initial,
    maxPagesPerChunk: 1,
    terminal: COMPLETE_PHASE,
  },
  rivervalley: {
    initialCursor: RivervalleyCursor.initial,
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
  fenix: {
    initialCursor: FenixCursor.initial,
    maxPagesPerChunk: 16,
    terminal: COMPLETE_PHASE,
  },
  importapart: {
    initialCursor: ImportapartCursor.initial,
    maxPagesPerChunk: 16,
    terminal: COMPLETE_PHASE,
  },
  army: {
    initialCursor: ArmyCursor.initial,
    maxPagesPerChunk: 1,
    terminal: COMPLETE_PHASE,
  },
  idipull: {
    initialCursor: IdipullCursor.initial,
    maxPagesPerChunk: 1,
    terminal: COMPLETE_PHASE,
  },
  bigd: {
    initialCursor: BigdCursor.initial,
    maxPagesPerChunk: 4,
    terminal: COMPLETE_PHASE,
  },
  pullsavewa: {
    initialCursor: PullsavewaCursor.initial,
    maxPagesPerChunk: 1,
    terminal: COMPLETE_PHASE,
  },
  littleton: {
    initialCursor: LittletonCursor.initial,
    maxPagesPerChunk: 16,
    terminal: COMPLETE_PHASE,
  },
  michigantruck: {
    initialCursor: MichigantruckCursor.initial,
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
  joliet: {
    initialCursor: JolietCursor.initial,
    maxPagesPerChunk: 16,
    terminal: COMPLETE_PHASE,
  },
  alln1: {
    initialCursor: Alln1Cursor.initial,
    maxPagesPerChunk: 3,
    terminal: COMPLETE_PHASE,
  },
  grandpajohns: {
    initialCursor: GrandpajohnsCursor.initial,
    maxPagesPerChunk: 3,
    terminal: COMPLETE_PHASE,
  },
  pickers: {
    initialCursor: PickersCoverageCursor.initial,
    maxPagesPerChunk: 16,
    terminal: COMPLETE_PHASE,
  },
  pipes: {
    initialCursor: PipesCursor.initial,
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
  uwrench: {
    initialCursor: UwrenchCursor.initial,
    maxPagesPerChunk: 16,
    terminal: COMPLETE_PHASE,
  },
  millerstown: {
    initialCursor: MillerstownCursor.initial,
    maxPagesPerChunk: 1,
    terminal: COMPLETE_PHASE,
  },
  pickapartva: {
    initialCursor: PickapartvaCursor.initial,
    maxPagesPerChunk: 15,
    terminal: COMPLETE_PHASE,
  },
  mccauley: {
    initialCursor: MccauleyCursor.initial,
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
  rustyhook: {
    initialCursor: RustyhookCursor.initial,
    maxPagesPerChunk: 3,
    terminal: COMPLETE_PHASE,
  },
  aviation: {
    initialCursor: AviationCursor.initial,
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
  chaz: {
    initialCursor: ChazCursor.initial,
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
  citymotors: {
    initialCursor: CitymotorsCursor.initial,
    // Three worst-case 45 s GETs plus gaps and the completion reserve fit the
    // connector's 3-minute deadline.
    maxPagesPerChunk: 3,
    terminal: COMPLETE_PHASE,
  },
  awap: {
    initialCursor: AwapCursor.initial,
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
  clearsalvage: {
    initialCursor: ClearsalvageCursor.initial,
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
  aplus: {
    initialCursor: AplusCursor.initial,
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
  central: {
    initialCursor: CentralCursor.initial,
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
  northwest: {
    initialCursor: NorthwestCursor.initial,
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
  coutu: {
    initialCursor: CoutuCursor.initial,
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
  kodak: {
    initialCursor: KodakCursor.initial,
    maxPagesPerChunk: 2,
    terminal: COMPLETE_PHASE,
  },
  six03: {
    initialCursor: Six03Cursor.initial,
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
  rohner: {
    initialCursor: RohnerCursor.initial,
    maxPagesPerChunk: 3,
    terminal: COMPLETE_PHASE,
  },
  pratt: {
    initialCursor: PrattCursor.initial(PRATT_CONTRACT),
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
  cars4parts: {
    initialCursor: Cars4PartsCursor.initial(CARS4PARTS_CONTRACT),
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
  meeks: {
    initialCursor: MeeksCursor.initial,
    maxPagesPerChunk: 1,
    terminal: COMPLETE_PHASE,
  },
  brandywine: {
    initialCursor: BrandywineCursor.initial(null),
    maxPagesPerChunk: 3,
    terminal: COMPLETE_PHASE,
  },
  rmmdtp: {
    initialCursor: RmmdtpCursor.initial(RMMDTP_CONTRACT),
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
  calton: {
    initialCursor: initialCalton.value,
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
  bigtruckpage: {
    initialCursor: BigtruckpageCursor.initial,
    maxPagesPerChunk: 2,
    terminal: COMPLETE_PHASE,
  },
  speedys: {
    initialCursor: SpeedysCursor.initial,
    maxPagesPerChunk: 2,
    terminal: COMPLETE_PHASE,
  },
  sandw: {
    initialCursor: SandwCursor.initial(),
    maxPagesPerChunk: 5,
    terminal: COMPLETE_PHASE,
  },
  denton: {
    initialCursor: initialDenton.value,
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
  beavers: {
    initialCursor: BeaversCursor.initial,
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
  indianriver: {
    initialCursor: IndianriverCursor.initial(),
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
  scotts: {
    initialCursor: ScottsCursor.initial,
    maxPagesPerChunk: 6,
    terminal: COMPLETE_PHASE,
  },
  oem: {
    initialCursor: OemCursor.initial(),
    maxPagesPerChunk: 8,
    terminal: {
      kind: "cursor",
      isTerminal: (cursor) => cursor.state.phase === "complete",
    },
  },
  dutchers: {
    initialCursor: DutchersCursor.initial(),
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
  alsauto: {
    initialCursor: AlsautoCursor.initial(),
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
  chasencars: {
    initialCursor: ChasencarsCursor.initial(null),
    maxPagesPerChunk: 6,
    terminal: COMPLETE_PHASE,
  },
  weberbrothers: {
    initialCursor: WeberbrothersCursor.initial,
    maxPagesPerChunk: 10,
    terminal: COMPLETE_PHASE,
  },
  hawaiiparts: {
    initialCursor: HawaiipartsCursor.initial(),
    maxPagesPerChunk: 4,
    terminal: COMPLETE_PHASE,
  },
  modernmuscle: {
    initialCursor: ModernmuscleCursor.initial(),
    maxPagesPerChunk: 4,
    terminal: COMPLETE_PHASE,
  },
  carsandparts: {
    initialCursor: CarsandpartsCursor.initial(),
    maxPagesPerChunk: 4,
    terminal: COMPLETE_PHASE,
  },
  spartan: {
    initialCursor: SpartanCursor.initial(),
    maxPagesPerChunk: 4,
    terminal: COMPLETE_PHASE,
  },
  oemgarage: {
    initialCursor: OemgarageCursor.initial(),
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
  hagerman: {
    initialCursor: HagermanCursor.initial,
    maxPagesPerChunk: 12,
    terminal: COMPLETE_PHASE,
  },
  kandr: {
    initialCursor: initialKandr.value,
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
  jimsimport: {
    initialCursor: JimsimportCursor.initial(),
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
  lonestarimports: {
    initialCursor: LonestarimportsCursor.initial(null),
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
  alshned: {
    initialCursor: AlshnedCursor.initial,
    maxPagesPerChunk: 12,
    terminal: COMPLETE_PHASE,
  },
  hollanderstores: {
    initialCursor: HollanderstoresDurableCursor.initial(),
    maxPagesPerChunk: 1,
    terminal: COMPLETE_PHASE,
  },
  cstruck: {
    initialCursor: CstruckCursor.initial(),
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
  heavytruckparts: {
    initialCursor: HeavytruckpartsCursor.initial(),
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
  allied: {
    initialCursor: AlliedCursor.initial(ALLIED_CONTRACT),
    maxPagesPerChunk: 4,
    terminal: COMPLETE_PHASE,
  },
  byot: {
    initialCursor: ByotCursor.initial(),
    maxPagesPerChunk: BYOT_CHUNK_REQUESTS,
    terminal: COMPLETE_PHASE,
  },
  vinplus: {
    initialCursor: VinplusCursor.initial(),
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
  urgiis: {
    initialCursor: UrgiisCursor.initial(),
    maxPagesPerChunk: 3,
    terminal: COMPLETE_PHASE,
  },
  harrys: {
    initialCursor: HarrysCursor.initial(),
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
  budget: {
    initialCursor: BudgetCursor.initial(),
    maxPagesPerChunk: 8,
    terminal: COMPLETE_PHASE,
  },
};

export function getDurableSourceDefinition<
  Source extends DurableIngestionSource,
>(source: Source): DurableSourceDefinition<Source> {
  return DURABLE_SOURCE_DEFINITIONS[source];
}

/**
 * Whether a successful source run's persisted final cursor proves a finished
 * crawl. Fails closed: a missing or unparseable cursor is never terminal.
 */
export function isDurableSourceCursorTerminal<Source extends IngestionSource>(
  source: Source,
  serializedCursor: string | null,
): boolean {
  if (serializedCursor === null) return false;
  let cursor: DurableCursorFor<Source>;
  try {
    cursor = parseDurableSourceCursor(source, serializedCursor);
  } catch {
    return false;
  }
  const terminal = getDurableSourceDefinition(source).terminal;
  return terminal.kind === "connector-status" || terminal.isTerminal(cursor);
}

export const DURABLE_INITIAL_SOURCE_CURSORS: readonly DurableSourceCursor[] =
  INGESTION_SOURCES.map(
    (source) => getDurableSourceDefinition(source).initialCursor,
  );
