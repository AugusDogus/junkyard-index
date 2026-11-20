import { describe, expect, test } from "bun:test";
import {
  INGESTION_SOURCES,
  type IngestionSource,
} from "~/lib/ingestion-source";
import {
  DURABLE_SOURCE_DEFINITIONS,
  isDurableSourceCursorTerminal,
  serializeDurableSourceCursor,
  type DurableCursorFor,
} from "./durable-source";
import { VanderHaagsCensus } from "./vanderhaags-census";

type TerminalSample<Source extends IngestionSource> =
  | {
      kind: "cursor";
      /** Builds the source's finished checkpoint from its initial cursor. */
      terminal: (initial: DurableCursorFor<Source>) => DurableCursorFor<Source>;
    }
  | { kind: "connector-status" };

/**
 * Phase cursors finish in their `complete` variant. Calling this for a cursor
 * union without that variant is a compile error, because the connector could
 * never produce a cursor that validation accepts.
 */
function phase<Cursor extends { phase: string }>(
  ..._requiresCompletePhase: "complete" extends Cursor["phase"]
    ? []
    : [missingCompletePhase: never]
): { kind: "cursor"; terminal: (initial: Cursor) => Cursor } {
  return {
    kind: "cursor",
    terminal: (initial) => ({ ...initial, phase: "complete" }),
  };
}

const PYP_STORES = Array.from({ length: 20 }, (_, index) =>
  String(index).padStart(2, "0"),
);

/**
 * Every registered source, with the finished cursor its connector returns on a
 * complete crawl. Sources whose cursor cannot prove completion are explicit.
 */
const TERMINAL_SAMPLES: {
  [Source in IngestionSource]: TerminalSample<Source>;
} = {
  row52: { kind: "connector-status" },
  pyp: {
    kind: "cursor",
    terminal: (initial) => ({
      ...initial,
      storeCodes: PYP_STORES,
      storeIndex: PYP_STORES.length,
      page: 0,
    }),
  },
  autorecycler: {
    kind: "cursor",
    terminal: () => ({
      source: "autorecycler",
      phase: "complete",
      freshness: { asOf: 1, legacy: {}, eligibleYards: ["1"] },
    }),
  },
  pullapart: { kind: "connector-status" },
  upullitne: { kind: "connector-status" },
  upullitdavie: {
    kind: "cursor",
    terminal: (initial) => ({
      ...initial,
      page: 4,
      totalPages: 3,
      totalCount: 250,
      pageSize: 100,
      recordsProcessed: 250,
    }),
  },
  gopullit: { kind: "connector-status" },
  pullnsave: { kind: "connector-status" },
  tearapart: { kind: "connector-status" },
  wrenchapart: { kind: "connector-status" },
  upullrparts: phase(),
  ipullupull: {
    kind: "cursor",
    terminal: () => ({ source: "ipullupull", catalog: 1 }),
  },
  upullitwa: phase(),
  partsgalore: {
    kind: "cursor",
    terminal: () => ({ source: "partsgalore", catalog: 1 }),
  },
  rtp: phase(),
  nvpap: phase(),
  pontiac: phase(),
  aero: phase(),
  vanderhaags: {
    kind: "cursor",
    terminal: () => ({
      source: "vanderhaags",
      phase: "complete",
      census: VanderHaagsCensus.checkpoint({
        contract: "detail-census-v2",
        scope: "a".repeat(64),
        startedAt: 0,
        reverification: { day: 0, paths: [] },
        entries: [],
      }),
    }),
  },
  chesterfield: phase(),
  utpap: phase(),
  tritown: phase(),
  whitebradstreet: phase(),
  midway: phase(),
  rightway: phase(),
  ddauto: phase(),
  rivervalley: phase(),
  fenix: phase(),
  importapart: phase(),
  army: phase(),
  idipull: phase(),
  bigd: phase(),
  pullsavewa: phase(),
  littleton: phase(),
  michigantruck: phase(),
  joliet: phase(),
  alln1: phase(),
  grandpajohns: phase(),
  pickers: phase(),
  pipes: phase(),
  uwrench: phase(),
  millerstown: phase(),
  pickapartva: phase(),
  mccauley: phase(),
  rustyhook: phase(),
  aviation: phase(),
  chaz: phase(),
  citymotors: phase(),
  awap: phase(),
  clearsalvage: phase(),
  aplus: phase(),
  central: phase(),
  northwest: phase(),
  coutu: phase(),
  kodak: phase(),
  six03: phase(),
  rohner: phase(),
  pratt: phase(),
  cars4parts: phase(),
  meeks: phase(),
  brandywine: phase(),
  rmmdtp: phase(),
  calton: phase(),
  bigtruckpage: phase(),
  speedys: phase(),
  sandw: phase(),
  denton: phase(),
  beavers: phase(),
  indianriver: phase(),
  scotts: phase(),
  oem: {
    kind: "cursor",
    terminal: (initial) => ({ ...initial, state: { phase: "complete" } }),
  },
  dutchers: phase(),
  alsauto: phase(),
  chasencars: phase(),
  weberbrothers: phase(),
  hawaiiparts: phase(),
  modernmuscle: phase(),
  carsandparts: phase(),
  spartan: phase(),
  oemgarage: phase(),
  hagerman: phase(),
  kandr: phase(),
  jimsimport: phase(),
  lonestarimports: phase(),
  alshned: phase(),
  hollanderstores: phase(),
  cstruck: phase(),
  heavytruckparts: phase(),
  allied: phase(),
  byot: phase(),
  vinplus: phase(),
  urgiis: phase(),
  harrys: phase(),
  budget: phase(),
};

function expectTerminalBehavior<Source extends IngestionSource>(
  source: Source,
) {
  const definition = DURABLE_SOURCE_DEFINITIONS[source];
  const sample: TerminalSample<Source> = TERMINAL_SAMPLES[source];
  const midCrawl = serializeDurableSourceCursor(definition.initialCursor);
  expect(definition.terminal.kind).toBe(sample.kind);
  if (definition.terminal.kind === "connector-status") {
    expect(definition.terminal.reason).not.toBe("");
    expect(isDurableSourceCursorTerminal(source, midCrawl)).toBe(true);
    return;
  }
  if (sample.kind !== "cursor") throw new Error(`${source} needs a sample`);
  expect(definition.terminal.isTerminal(definition.initialCursor)).toBe(false);
  expect(isDurableSourceCursorTerminal(source, midCrawl)).toBe(false);
  expect(
    definition.terminal.isTerminal(sample.terminal(definition.initialCursor)),
  ).toBe(true);
}

describe("durable source terminal evidence", () => {
  test.each([...INGESTION_SOURCES])(
    "%s accepts only a finished final cursor",
    (source) => expectTerminalBehavior(source),
  );

  test("only sources without a completion marker rely on connector status", () => {
    expect(
      INGESTION_SOURCES.filter(
        (source) =>
          DURABLE_SOURCE_DEFINITIONS[source].terminal.kind ===
          "connector-status",
      ),
    ).toEqual([
      "row52",
      "pullapart",
      "upullitne",
      "gopullit",
      "pullnsave",
      "tearapart",
      "wrenchapart",
    ]);
  });

  test.each([...INGESTION_SOURCES])(
    "%s fails closed without a parseable final cursor",
    (source) => {
      expect(isDurableSourceCursorTerminal(source, null)).toBe(false);
      expect(isDurableSourceCursorTerminal(source, "{not json")).toBe(false);
    },
  );

  test("round trips finished cursors that use the shared wire codecs", () => {
    expect(
      isDurableSourceCursorTerminal("rightway", '{"phase":"complete"}'),
    ).toBe(true);
    expect(isDurableSourceCursorTerminal("ipullupull", "1")).toBe(true);
    expect(isDurableSourceCursorTerminal("ipullupull", "0")).toBe(false);
    expect(
      isDurableSourceCursorTerminal(
        "pyp",
        JSON.stringify({ storeCodes: PYP_STORES, storeIndex: 20, page: 0 }),
      ),
    ).toBe(true);
    expect(
      isDurableSourceCursorTerminal(
        "pyp",
        JSON.stringify({ storeCodes: PYP_STORES, storeIndex: 19, page: 3 }),
      ),
    ).toBe(false);
  });
});
