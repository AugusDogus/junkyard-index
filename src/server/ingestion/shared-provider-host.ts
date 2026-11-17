import { Effect } from "effect";
import { URGIIS_TENANTS } from "./urgiis-configuration";
import {
  providerHostSlot,
  type ProviderHostPolicy,
} from "./provider-host-slot";

export const URG_HOST_POLICY: ProviderHostPolicy = {
  key: "urg-iis",
  label: "URG IIS",
  leaseMs: 130_000,
  requestMs: 110_000,
  waitMs: 30 * 60_000,
  pollMs: 1_000,
  gapMs: 3_500,
};
export const VINPLUS_HOST_POLICY: ProviderHostPolicy = {
  key: "inventory-search-api-581547763015.us-central1.run.app",
  label: "VinPlus",
  leaseMs: 90_000,
  requestMs: 65_000,
  waitMs: 10 * 60_000,
  pollMs: 1_000,
  gapMs: 1_600,
};

// URG qualification treated tenant origins as one backend, rather than trusting
// distinct WordPress hostnames to imply separate capacity. Include the native
// IIS catalogs conservatively, even when only their page/storage shape links
// them to URG. See docs/runbooks/provider-launch-readiness.md for evidence.
const urgHosts = new Set([
  ...URGIIS_TENANTS.map((tenant) =>
    new URL(tenant.origin).hostname.replace(/^www\./, ""),
  ),
  "aviationauto.com",
  "chazsauto.com",
  "aplusauto.parts",
  "centralautoliq.com",
  "northwestautoparts.com",
  "prattsautosalvage.com",
  "caltonautoparts.com",
  "dentonauto.com",
  "oemautorecyclers.com",
  "jimsimport.com",
  "hondapartsused.com",
  "pickapartva.com",
  "alln1kc.com",
  "grandpajohnsautoparts.com",
  "midwayupull.com",
  "indianriverautosalvage.com",
  "alliedautowrecking.com",
  "ifipull.com",
]);
export function sharedProviderHostPolicy(
  url: string,
): ProviderHostPolicy | null {
  const host = URL.parse(url)?.hostname.replace(/^www\./, "");
  if (host === VINPLUS_HOST_POLICY.key) return VINPLUS_HOST_POLICY;
  return host && urgHosts.has(host) ? URG_HOST_POLICY : null;
}

/** Wrap the complete response/body lifetime, not just fetch headers. Every
 * retry must acquire its own FIFO slot, and every failure holds the same gap. */
export const sharedProviderHostSlot =
  (url: string) =>
  <A, E, R>(request: Effect.Effect<A, E, R>) => {
    const policy = sharedProviderHostPolicy(url);
    return policy ? providerHostSlot(policy, request) : request;
  };
