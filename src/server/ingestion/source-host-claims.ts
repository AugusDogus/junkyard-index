import type { DurableSourceCursor } from "./durable-cursor";
import type { DurableIngestionSource } from "./durable-source";
import { heavyTruckPartsHostPolicy } from "./heavytruckparts-host-slot";
import { HostClaims, type HostPlace } from "./host-claims";
import type { ProviderLeasePolicy } from "./provider-host-slot";
import {
  VINPLUS_HOST_POLICY,
  sharedProviderHostPolicy,
} from "./shared-provider-host";
import { ALLIED_ORIGIN } from "./allied-html";
import { ALLN1_ORIGIN, GRANDPAJOHNS_TENANT } from "./alln1-yard-metadata";
import { APLUS_ORIGIN } from "./aplus-yard-metadata";
import { AVIATION_ORIGIN } from "./aviation-yard-metadata";
import { CALTON_ORIGIN } from "./calton-html";
import { CENTRAL_ORIGIN } from "./central-yard-metadata";
import { CHAZ_ORIGIN } from "./chaz-yard-metadata";
import { DENTON_ORIGIN } from "./denton-html";
import { JIMSIMPORT_ORIGIN } from "./jimsimport-yard-metadata";
import { MIDWAY_ORIGIN } from "./midway-yard-metadata";
import { NORTHWEST_ORIGIN } from "./northwest-html";
import { OEM_ORIGIN } from "./oem-html";
import { PICKAPARTVA_ORIGIN } from "./pickapartva-yard-metadata";
import { PRATT_ORIGIN } from "./pratt-html";
import { SCOTTS_ORIGIN } from "./scotts-yard-metadata";
import { URGIIS_TENANTS } from "./urgiis-configuration";

/** Every URG origin a source sends shared host turns to, in crawl order. */
const URG_ORIGINS: Partial<Record<DurableIngestionSource, readonly string[]>> =
  {
    allied: [ALLIED_ORIGIN],
    alln1: [ALLN1_ORIGIN],
    aplus: [APLUS_ORIGIN],
    aviation: [AVIATION_ORIGIN],
    calton: [CALTON_ORIGIN],
    central: [CENTRAL_ORIGIN],
    chaz: [CHAZ_ORIGIN],
    denton: [DENTON_ORIGIN],
    grandpajohns: [GRANDPAJOHNS_TENANT.origin],
    jimsimport: [JIMSIMPORT_ORIGIN],
    midway: [MIDWAY_ORIGIN],
    northwest: [NORTHWEST_ORIGIN],
    oem: [OEM_ORIGIN],
    pickapartva: [PICKAPARTVA_ORIGIN],
    pratt: [PRATT_ORIGIN],
    scotts: [SCOTTS_ORIGIN],
    urgiis: URGIIS_TENANTS.map((tenant) => tenant.origin),
  };

/** Sources whose every request takes a VinPlus or Heavy Truck Parts slot. */
const HOST_POLICIES: Partial<
  Record<DurableIngestionSource, readonly ProviderLeasePolicy[]>
> = {
  vinplus: [VINPLUS_HOST_POLICY],
  joliet: [VINPLUS_HOST_POLICY],
  littleton: [VINPLUS_HOST_POLICY],
  pickers: [VINPLUS_HOST_POLICY],
  pipes: [VINPLUS_HOST_POLICY],
  uwrench: [VINPLUS_HOST_POLICY],
  heavytruckparts: [heavyTruckPartsHostPolicy],
  cstruck: [heavyTruckPartsHostPolicy],
  dutchers: [heavyTruckPartsHostPolicy],
};

/** Claims for the lanes of `policies`, with one place in each group. */
function claimsOf(policies: readonly ProviderLeasePolicy[]): HostClaims {
  const lanes = [...new Set(policies.map((policy) => policy.key))];
  const places = new Map<string, HostPlace>();
  for (const { group } of policies)
    if (group)
      places.set(group.key, { group: group.key, capacity: group.activeLanes });
  return { lanes, places: [...places.values()] };
}

/** The URG IIS tenant origins from the `tenantsDone`th on: one per chunk, in
 * order, so a cursor's `completed` count names the tenant it reads next. */
const urgiisOrigins = (from: number, count = URGIIS_TENANTS.length) =>
  URGIIS_TENANTS.slice(from, from + count).map((tenant) => tenant.origin);

function claimsOfOrigins(
  source: DurableIngestionSource,
  origins: readonly string[],
): HostClaims {
  return claimsOf([
    ...origins.flatMap((origin) => sharedProviderHostPolicy(origin) ?? []),
    ...(HOST_POLICIES[source] ?? []),
  ]);
}

export const SourceHostClaims = {
  /**
   * Every shared host `source` may fetch from over a run (see `HostClaims`).
   * A source crawls its lanes one request at a time, so it takes one place
   * in a group however many of the group's lanes it crawls. Browser sources
   * claim no place: they sleep through most of a run with no browser open,
   * and the provider's refusal past its concurrent limit defers a chunk
   * (`KernelSessions.capacityDeferral`).
   */
  of(source: DurableIngestionSource): HostClaims {
    return claimsOfOrigins(source, URG_ORIGINS[source] ?? []);
  },

  /**
   * What a run of `source` needs for its next chunk. URG IIS reads one
   * tenant at a time, so it claims only the tenant after its `tenantsDone`
   * finished ones, and hands its claims back to the pass before a tenant on
   * another lane. Other sources ignore `tenantsDone`.
   */
  next(source: DurableIngestionSource, tenantsDone: number): HostClaims {
    return source === "urgiis"
      ? claimsOfOrigins(source, urgiisOrigins(tenantsDone, 1))
      : SourceHostClaims.of(source);
  },

  /**
   * What a fetching run that this pass did not admit may occupy. Its
   * workflow may be on a deployment that crawls every unfinished URG IIS
   * tenant without handing claims back, so it holds them all.
   */
  held(source: DurableIngestionSource, tenantsDone: number): HostClaims {
    return source === "urgiis"
      ? claimsOfOrigins(source, urgiisOrigins(tenantsDone))
      : SourceHostClaims.of(source);
  },

  /** What the chunk that reads from `cursor` needs. */
  ofCursor(cursor: DurableSourceCursor): HostClaims {
    return SourceHostClaims.next(
      cursor.source,
      SourceHostClaims.tenantsDone(cursor),
    );
  },

  /** URG IIS tenants `cursor` has finished; 0 for every other source. */
  tenantsDone(cursor: DurableSourceCursor): number {
    return cursor.source === "urgiis" ? cursor.completed.length : 0;
  },

  /**
   * What a run that the pass admitted for `admitted` must hand back to the
   * pass for, once a chunk (fetched, or a stored checkpoint a restarted
   * workflow replayed) left it with `tenantsDone` finished tenants: the
   * claims of its next chunk, when `admitted` does not cover them. Null
   * when it may go on.
   */
  handBack(
    source: DurableIngestionSource,
    admitted: HostClaims,
    tenantsDone: number,
  ): HostClaims | null {
    const next = SourceHostClaims.next(source, tenantsDone);
    return HostClaims.covers(admitted, next) ? null : next;
  },
} as const;
