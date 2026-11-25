import type { Effect } from "effect";
import { URGIIS_TENANTS } from "./urgiis-configuration";
import {
  providerHostSlot,
  providerHostTurn,
  type ProviderHostGroup,
  type ProviderHostPolicy,
} from "./provider-host-slot";

/** The WordPress plugin on every URG site calls a central URG API, so only a
 * few URG lanes may hold a lease at once. Six lets the morning's native
 * full reads finish by about 10:00 UTC next to URG IIS, which holds one place
 * all morning; with four they queued past 11:00. No URG host has answered
 * 429 (about 17,800 saved requests), and response times barely correlate
 * across servers, so the central API showed no shared limit. */
export const URG_HOST_GROUP: ProviderHostGroup = { key: "urg", activeLanes: 6 };
const urgLane = (server: string): ProviderHostPolicy => ({
  key: "urg:" + server,
  label: "URG " + server,
  leaseMs: 130_000,
  requestMs: 110_000,
  waitMs: 30 * 60_000,
  pollMs: 1_000,
  gapMs: 3_500,
  group: URG_HOST_GROUP,
});
export const VINPLUS_HOST_POLICY: ProviderHostPolicy = {
  key: "inventory-search-api-581547763015.us-central1.run.app",
  label: "VinPlus",
  leaseMs: 90_000,
  requestMs: 65_000,
  waitMs: 10 * 60_000,
  pollMs: 1_000,
  gapMs: 1_600,
};

/** URG hosts that share an origin server, by lane. Response times correlate
 * within a server but not across them, and DNS resolves each set to the same
 * addresses. See docs/runbooks/provider-launch-readiness.md. */
const URG_SERVERS: Readonly<Record<string, readonly string[]>> = {
  // URG's own AWS load balancer (`x-urg-storage` header, six shared IPs).
  // Its five sources read about 2,800 model pages a day; one lane took about
  // 7 hours, so two lanes of about 1,400 GETs each split them. The balancer
  // then sees at most two of our requests at once, each lane still with its
  // own gap.
  "aws-1": ["aviationauto.com", "caltonautoparts.com", "hondapartsused.com"],
  "aws-2": ["centralautoliq.com", "jimsimport.com"],
  // Vultr 66.42.115.19 (Cloudways).
  "66.42.115.19": ["lambertsalvage.com", "prattsautosalvage.com"],
  // Vultr 149.28.120.41, shared with Metro, which is not a source.
  "149.28.120.41": ["chazsauto.com"],
};
// The URG IIS tenants and native IIS catalogs. Hosts behind Cloudflare, or
// without evidence of sharing a server, each get their own lane. I-Pull and
// Indian River are not URG sites and keep only their own client pacing.
const urgHosts = [
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
  "alliedautowrecking.com",
];
const urgServerLanes = new Map(
  Object.entries(URG_SERVERS).flatMap(([server, hosts]) => {
    const lane = urgLane(server);
    return hosts.map((host) => [host, lane] as const);
  }),
);
const urgLanes = new Map(
  urgHosts.map((host) => [host, urgServerLanes.get(host) ?? urgLane(host)]),
);
export function sharedProviderHostPolicy(
  url: string,
): ProviderHostPolicy | null {
  const host = URL.parse(url)?.hostname.replace(/^www\./, "");
  if (host === VINPLUS_HOST_POLICY.key) return VINPLUS_HOST_POLICY;
  return (host && urgLanes.get(host)) || null;
}

/** Wrap the complete response/body lifetime, not just fetch headers. Every
 * retry must acquire its own FIFO slot, and every failure holds the same gap.
 * Every request to a shared host takes a slot, including one inside a turn:
 * there the slot keeps the gap after the turn's previous request and records
 * its own end for the next. */
export const sharedProviderHostSlot =
  (url: string) =>
  <A, E, R>(request: Effect.Effect<A, E, R>) => {
    const policy = sharedProviderHostPolicy(url);
    return policy ? providerHostSlot(policy, request) : request;
  };

/**
 * One queue turn for `requests` sequential requests to `url`'s backend, each
 * still followed by the policy gap. `afterMs` reserves chunk time for work
 * outside any turn that must follow this one. Connectors take a turn at every request
 * site, grouping requests that only together let a chunk advance, so every
 * chunk advances with one turn. Inside a chunk deadline a turn that cannot end
 * before the chunk's turn horizon fails with `ProviderTurnDeferred` (see
 * `ProviderChunkClock.unlessDeferred`). Without a shared policy for `url` this
 * is `unit`.
 */
export const sharedProviderHostTurn =
  (url: string, requests = 1, afterMs = 0) =>
  <A, E, R>(unit: Effect.Effect<A, E, R>) => {
    const policy = sharedProviderHostPolicy(url);
    return policy ? providerHostTurn(policy, requests, unit, afterMs) : unit;
  };

/** One request in its own shared host turn. The request still takes a host
 * slot, so inside an enclosing turn it keeps the gap on both sides. */
export const sharedProviderHostRequest =
  (url: string) =>
  <A, E, R>(request: Effect.Effect<A, E, R>) =>
    request.pipe(sharedProviderHostSlot(url), sharedProviderHostTurn(url));
