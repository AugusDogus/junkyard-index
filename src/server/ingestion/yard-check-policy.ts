import type { IngestionSource } from "~/lib/ingestion-source";
import { YardCheck, type YardCheckReport } from "~/lib/yard-check";

/**
 * How a source's runs prove which yards they checked, for sources whose
 * connector does not report `yardChecks` itself. Audited per source in
 * November 2026 (durable-source-fetch.ts and each connector).
 * - live: every vehicle a chunk emits came from a live request for its yard
 *   in this run; nothing is carried from an earlier run. Each yard a chunk
 *   emits vehicles for is "fetched".
 * - census: an incremental census. Every run reads the yard's live index
 *   (directory, make menus, model counts or arrivals), so a new arrival is
 *   seen that day, and carries only unchanged pages from the last accepted
 *   census, within its sweep and age limits. Its yards count as "fetched" the
 *   same way. BYOT also resumes a failed attempt from the same ingestion
 *   day, whose live requests are hours old at most.
 * - cursor: per-yard results are derived from the run's final cursor
 *   (run-snapshot-inventory.ts), not its chunks.
 * - unreported: nothing proves a per-yard check; its yards stay unreported.
 */
export type YardCheckPolicy =
  | { kind: "live" }
  | { kind: "census" }
  | { kind: "cursor" }
  | { kind: "unreported"; reason: string };

const live: YardCheckPolicy = { kind: "live" };
const census: YardCheckPolicy = { kind: "census" };
const cursor: YardCheckPolicy = { kind: "cursor" };

/** Every source declares one, so a new source never reports "fetched" by default. */
export const YARD_CHECK_POLICIES: Readonly<
  Record<IngestionSource, YardCheckPolicy>
> = {
  row52: live,
  pyp: live,
  autorecycler: cursor,
  pullapart: live,
  upullitne: live,
  upullitdavie: live,
  gopullit: live,
  pullnsave: live,
  tearapart: live,
  wrenchapart: live,
  upullrparts: live,
  ipullupull: live,
  upullitwa: live,
  partsgalore: live,
  rtp: live,
  nvpap: live,
  pontiac: live,
  aero: live,
  vanderhaags: census,
  chesterfield: live,
  utpap: live,
  tritown: live,
  whitebradstreet: live,
  midway: live,
  rightway: live,
  ddauto: live,
  rivervalley: live,
  fenix: live,
  importapart: live,
  army: live,
  idipull: live,
  bigd: live,
  pullsavewa: live,
  littleton: live,
  michigantruck: live,
  joliet: live,
  alln1: live,
  grandpajohns: live,
  pickers: live,
  pipes: live,
  uwrench: live,
  millerstown: live,
  pickapartva: live,
  mccauley: live,
  rustyhook: live,
  aviation: census,
  chaz: census,
  citymotors: live,
  awap: live,
  clearsalvage: live,
  aplus: census,
  central: census,
  northwest: census,
  coutu: live,
  kodak: live,
  six03: census,
  rohner: live,
  pratt: live,
  cars4parts: live,
  meeks: live,
  brandywine: live,
  rmmdtp: live,
  calton: census,
  bigtruckpage: live,
  speedys: live,
  sandw: live,
  denton: census,
  beavers: live,
  indianriver: live,
  scotts: census,
  oem: census,
  dutchers: live,
  alsauto: live,
  chasencars: live,
  weberbrothers: live,
  hawaiiparts: live,
  modernmuscle: live,
  carsandparts: live,
  spartan: live,
  oemgarage: live,
  hagerman: live,
  kandr: live,
  jimsimport: census,
  lonestarimports: live,
  alshned: live,
  hollanderstores: cursor,
  cstruck: live,
  heavytruckparts: live,
  allied: live,
  byot: census,
  vinplus: live,
  urgiis: cursor,
  harrys: live,
  budget: live,
};

export const YardCheckPolicy = {
  /**
   * The reports a chunk of `source` makes for itself when its connector
   * reported none: "fetched" for every yard it emitted vehicles for, under a
   * live or census policy, and nothing otherwise.
   */
  chunkReports(
    source: IngestionSource,
    vehicles: readonly { locationCode: string }[],
  ): YardCheckReport[] {
    const policy = YARD_CHECK_POLICIES[source];
    return policy.kind === "live" || policy.kind === "census"
      ? YardCheck.all(
          vehicles.map((vehicle) => vehicle.locationCode),
          "fetched",
        )
      : [];
  },
} as const;
