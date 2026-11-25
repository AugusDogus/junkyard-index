import { BROWSER_PROVIDERS, type BrowserSource } from "./browser-providers";
import type { DurableIngestionSource } from "./durable-source";
import { heavyTruckPartsHostPolicy } from "./heavytruckparts-host-slot";
import { HostClaims, type HostPlace } from "./host-claims";
import { HyperbrowserSessions } from "./hyperbrowser-sessions";
import { KernelSessions } from "./kernel-sessions";
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

/** Every URG origin a source sends shared host turns to. */
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

const isBrowserSource = (source: string): source is BrowserSource =>
  Object.hasOwn(BROWSER_PROVIDERS, source);

/** The session lease policy of a source that opens remote browsers. */
function browserPolicy(source: DurableIngestionSource): ProviderLeasePolicy[] {
  if (!isBrowserSource(source)) return [];
  switch (BROWSER_PROVIDERS[source]) {
    case "kernel":
      return [KernelSessions.policy(source)];
    case "hyperbrowser":
      return [HyperbrowserSessions.policy(source)];
  }
}

/** Claims for the lanes of `policies`, with one place in each group. */
function claimsOf(policies: readonly ProviderLeasePolicy[]): HostClaims {
  const lanes = [...new Set(policies.map((policy) => policy.key))];
  const places = new Map<string, HostPlace>();
  for (const { group } of policies)
    if (group)
      places.set(group.key, { group: group.key, capacity: group.activeLanes });
  return { lanes, places: [...places.values()] };
}

export const SourceHostClaims = {
  /**
   * What `source` occupies while it fetches (see `HostClaims`). A source
   * crawls its lanes one request at a time, so it takes one place in a group
   * however many of the group's lanes it crawls.
   */
  of(source: DurableIngestionSource): HostClaims {
    return claimsOf([
      ...(URG_ORIGINS[source] ?? []).flatMap(
        (origin) => sharedProviderHostPolicy(origin) ?? [],
      ),
      ...(HOST_POLICIES[source] ?? []),
      ...browserPolicy(source),
    ]);
  },
} as const;
